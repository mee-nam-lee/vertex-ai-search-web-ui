import os
import json
from flask import Flask, request, Response, stream_with_context
from flask_cors import CORS # Import CORS
from dotenv import load_dotenv
from google.oauth2 import service_account
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.cloud import storage # Added for GCS signed URL
import datetime # Added for signed URL expiration
import requests # Using requests library for HTTP calls
import time

load_dotenv() # Load variables from .env file into environment

app = Flask(__name__)
CORS(app) # Enable CORS for all routes and origins by default.
          # For production, configure specific origins: CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}})

# Configuration - Values will be loaded from .env or system environment variables
SERVICE_ACCOUNT_FILE = os.environ.get('SERVICE_ACCOUNT_FILE') # Default removed, should be in .env
PROJECT_ID = os.environ.get('PROJECT_ID')
ENGINE_ID = os.environ.get('ENGINE_ID') # Used for Answer API
DATA_STORE_ID = os.environ.get('DATA_STORE_ID') # Used for Search API
LOCATION_ID = os.environ.get('LOCATION_ID', 'global')
COLLECTION_ID = os.environ.get('COLLECTION_ID', 'default_collection') # Used for Answer API
SERVING_CONFIG_ID = os.environ.get('SERVING_CONFIG_ID', 'default_search') # Potentially used by both

SCOPES = ['https://www.googleapis.com/auth/cloud-platform']

def get_access_token():
    """Fetches an OAuth2 access token using the service account."""
    try:
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE, scopes=SCOPES)
        
        # It's good practice to refresh the token if it's not valid or close to expiry,
        # though for service accounts, the initial token is typically valid for an hour.
        if not creds.valid:
            creds.refresh(GoogleAuthRequest())
        return creds.token
    except Exception as e:
        app.logger.error(f"Error getting access token: {e}")
        raise

@app.route('/api/answer', methods=['POST']) # Renamed from /api/stream-answer
def answer(): # Renamed from stream_answer
    if not PROJECT_ID or not ENGINE_ID or not COLLECTION_ID:
        app.logger.error("Backend not configured for Answer API: PROJECT_ID, ENGINE_ID, or COLLECTION_ID missing.")
        return Response(json.dumps({"error": "Answer API not configured on backend"}), status=500, mimetype='application/json')

    try:
        incoming_data = request.json
        query_text = incoming_data.get('query')
        app.logger.debug(f"Received request from frontend. Query: '{query_text}', Full payload: {incoming_data}")

        if not query_text:
            app.logger.warning("Query text missing from frontend request.")
            return Response(json.dumps({"error": "Query text is required"}), status=400, mimetype='application/json')

        token = get_access_token()
        
        # Answer API endpoint uses Engine ID and Collection ID
        api_endpoint = f"https://discoveryengine.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION_ID}/collections/{COLLECTION_ID}/engines/{ENGINE_ID}/servingConfigs/{SERVING_CONFIG_ID}:streamAnswer"

        # Request body for streamAnswer API (as previously defined)
        request_body = {
            "query": {"text": query_text},
            # ... (keep existing answerGenerationSpec, queryUnderstandingSpec etc.)
            "answerGenerationSpec": {
                "modelSpec": {"modelVersion": "stable"},
                "ignoreAdversarialQuery": True,
                "ignoreNonAnswerSeekingQuery": True,
                "ignoreLowRelevantContent": True,
                "includeCitations": True,
                #"answerLanguageCode": "ko-KR"
            },
            "queryUnderstandingSpec": {
                "queryClassificationSpec": {
                    "types": ["NON_ANSWER_SEEKING_QUERY", "NON_ANSWER_SEEKING_QUERY_V2"]
                }
            }
            # "streamResponse": True, // This field caused an error, removing it.
            # The :streamAnswer endpoint implies streaming.
        }

        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }

        # Make the streaming request to Google API
        # The 'requests' library with stream=True is used here.
        # For true server-sent events (SSE) from this Flask app to client,
        # we need to process the chunked response from Google.
        
        api_response = requests.post(api_endpoint, headers=headers, json=request_body, stream=True)
        api_response.raise_for_status() # Raise an exception for HTTP errors

        def generate():
            # Google's streamAnswer API returns a stream of JSON objects,
            # each on a new line. We need to forward these.
            app.logger.debug("Starting to process stream from Google API...")
            
            # The Google API streams a single JSON array. We need to read the whole thing,
            # then parse it, then re-stream its elements as NDJSON.
            try:
                # Read the entire response content. This might buffer the whole response if it's large.
                # For very large responses, a more sophisticated incremental JSON array parser would be needed,
                # but for typical answer streams, this should be acceptable.
                response_content_bytes = api_response.content # .content reads the whole body
                response_content_str = response_content_bytes.decode('utf-8')
                app.logger.debug(f"Full response content from Google: {response_content_str}")

                # Parse the entire string as a JSON array
                response_array = json.loads(response_content_str)
                
                # Now, iterate through the objects in the array and yield them one by one.
                for chunk_object in response_array:
                    #app.logger.debug(f"Yielding chunk to frontend: {json.dumps(chunk_object)}")
                    yield json.dumps(chunk_object) + '\n'
                    #time.sleep(1)
                
            except json.JSONDecodeError as je:
                app.logger.error(f"Failed to parse the full streamed response from Google as JSON array. Error: {je}. Content: {response_content_str}")
                yield json.dumps({"error": "Backend failed to parse Google API response", "details": str(je)}) + '\n'
            except Exception as ex:
                app.logger.error(f"Generic error processing stream from Google: {ex}")
                yield json.dumps({"error": "Backend generic error processing stream", "details": str(ex)}) + '\n'

            app.logger.debug("Finished yielding chunks to frontend.")
        
        return Response(stream_with_context(generate()), mimetype='application/x-ndjson')

    except requests.exceptions.HTTPError as http_err:
        # Ensure api_response is defined in this scope for error logging
        error_text = http_err.response.text if http_err.response else "No response body"
        app.logger.error(f"HTTP error occurred calling Answer API: {http_err} - {error_text}")
        error_details = {"error": str(http_err)}
        try:
            error_details = api_response.json()
        except ValueError:
            pass # Not a JSON response
        return Response(json.dumps(error_details), status=api_response.status_code, mimetype='application/json')
    except Exception as e:
        app.logger.error(f"An error occurred in answer (formerly stream_answer): {e}")
        return Response(json.dumps({"error": str(e)}), status=500, mimetype='application/json')

@app.route('/api/search', methods=['POST']) # Renamed from /api/search-documents
def search(): # Renamed from search_documents
    if not PROJECT_ID or not DATA_STORE_ID:
        app.logger.error("Backend not configured for Search API: PROJECT_ID or DATA_STORE_ID missing.")
        return Response(json.dumps({"error": "Search API not configured on backend"}), status=500, mimetype='application/json')

    try:
        incoming_data = request.json
        query_text = incoming_data.get('query')
        app.logger.debug(f"Received document search request from frontend. Query: '{query_text}', Full payload: {incoming_data}")

        if not query_text:
            app.logger.warning("Query text missing from frontend request for document search.")
            return Response(json.dumps({"error": "Query text is required"}), status=400, mimetype='application/json')

        token = get_access_token()
        
        # Search API endpoint uses Data Store ID
        # Path: projects/{project}/locations/{location}/collections/{collection}/dataStores/{data_store}/servingConfigs/{serving_config}:search
        # Using a simpler path if collection is not strictly part of data store serving config path for search:
        # Path: projects/{project}/locations/{location}/dataStores/{data_store}/servingConfigs/{serving_config}:search
        api_endpoint = f"https://discoveryengine.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION_ID}/dataStores/{DATA_STORE_ID}/servingConfigs/{SERVING_CONFIG_ID}:search"
        
        request_body = {
            "query": query_text,
            "pageSize": 3,
            "queryExpansionSpec": {
                "condition": "AUTO"
            },
            "spellCorrectionSpec": {
                "mode": "AUTO"
            },
            "contentSearchSpec": {
                "extractiveContentSpec": {
                    "maxExtractiveAnswerCount": 1
                }
                # If you also need snippets or summary here, they would be siblings to extractiveContentSpec
                # "snippetSpec": { "returnSnippet": True },
                # "summarySpec": { "summaryResultCount": 3, "includeCitations": True }
            }
        }

        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
        
        api_response = requests.post(api_endpoint, headers=headers, json=request_body)
        api_response.raise_for_status() # Raise an exception for HTTP errors
        
        results = api_response.json()
        #app.logger.debug(f"Search API response: {json.dumps(results, indent=2)}") # Log formatted JSON
        return Response(json.dumps(results), status=200, mimetype='application/json')

    except requests.exceptions.HTTPError as http_err:
        error_text = http_err.response.text if http_err.response else "No response body"
        app.logger.error(f"HTTP error occurred calling Search API: {http_err} - {error_text}")
        error_details = {"error": str(http_err)}
        try:
            error_details = http_err.response.json()
        except ValueError:
            pass 
        return Response(json.dumps(error_details), status=http_err.response.status_code, mimetype='application/json')
    except Exception as e:
        app.logger.error(f"An error occurred in search (formerly search_documents): {e}")
        return Response(json.dumps({"error": str(e)}), status=500, mimetype='application/json')

@app.route('/api/generate-signed-url', methods=['POST'])
def generate_signed_url():
    try:

        
        incoming_data = request.json
        gcs_uri = incoming_data.get('gcs_uri')

        app.logger.warning(f"Invalid GCS URI received: {gcs_uri}")

        if not gcs_uri or not gcs_uri.startswith('gs://'):
            app.logger.warning(f"Invalid GCS URI received: {gcs_uri}")
            return Response(json.dumps({"error": "Valid GCS URI is required (e.g., gs://bucket/object)"}), status=400, mimetype='application/json')

        # Parse bucket and blob name from GCS URI
        try:
            bucket_name = gcs_uri.split('/')[2]
            blob_name = '/'.join(gcs_uri.split('/')[3:])
        except IndexError:
            app.logger.warning(f"Could not parse bucket/blob from GCS URI: {gcs_uri}")
            return Response(json.dumps({"error": "Invalid GCS URI format"}), status=400, mimetype='application/json')

        if not bucket_name or not blob_name:
            app.logger.warning(f"Empty bucket or blob name from GCS URI: {gcs_uri}")
            return Response(json.dumps({"error": "Bucket and object name cannot be empty"}), status=400, mimetype='application/json')

        app.logger.debug(f"Request to generate signed URL for gs://{bucket_name}/{blob_name}")

        # Initialize GCS client
        # If SERVICE_ACCOUNT_FILE is set and valid, it will be used.
        # Otherwise, it attempts to use Application Default Credentials.
        storage_client = None
        if SERVICE_ACCOUNT_FILE:
            try:
                storage_client = storage.Client.from_service_account_json(SERVICE_ACCOUNT_FILE)
                app.logger.info(f"Using service account {SERVICE_ACCOUNT_FILE} for GCS client.")
            except Exception as sa_e:
                app.logger.warning(f"Failed to load GCS client from {SERVICE_ACCOUNT_FILE}: {sa_e}. Falling back to ADC if available.")
                storage_client = storage.Client() # Fallback
        else:
            storage_client = storage.Client()
            app.logger.info("Using Application Default Credentials for GCS client.")


        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_name)

        # Generate a v4 signed URL that expires in 15 minutes.
        # The service account needs the "Service Account Token Creator" role on itself.
        signed_url = blob.generate_signed_url(
            version="v4",
            expiration=datetime.timedelta(minutes=15),
            method="GET",
        )
        app.logger.debug(f"Generated signed URL: {signed_url}")
        return Response(json.dumps({"signedUrl": signed_url}), status=200, mimetype='application/json')

    except Exception as e:
        app.logger.error(f"Error generating signed URL: {e}")
        # Consider more specific error handling for GCS exceptions if needed
        return Response(json.dumps({"error": f"Failed to generate signed URL: {str(e)}"}), status=500, mimetype='application/json')

if __name__ == '__main__':
    app.run(debug=True, port=5001)
