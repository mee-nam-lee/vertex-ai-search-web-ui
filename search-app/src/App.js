import React, { useState, useEffect, useRef } from 'react';
import Markdown from 'markdown-to-jsx';
import Slider from "react-slick";
import "slick-carousel/slick/slick.css"; 
import "slick-carousel/slick/slick-theme.css";
import './App.css';

const handleDocumentLinkClick = async (event, uri, pageNumber, isPdf) => {
  event.preventDefault();
  let targetUrl = uri;
  let openNewWindow = true; // Flag to control opening, true by default

  if (!uri) {
    console.error("No URI provided to handleDocumentLinkClick");
    return;
  }

  if (uri.startsWith('gs://')) {
    //console.log(`Requesting signed URL for GCS URI: ${uri}`);
  try {
    const response = await fetch('http://localhost:5001/api/generate-signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gcs_uri: uri })
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Backend error: ${errorData.error || response.status}`);
    }
    const data = await response.json();
    if (data.signedUrl) {
      targetUrl = data.signedUrl;
    } else {
      throw new Error("No signedUrl received from backend.");
    }
  } catch (error) {
    console.error("Failed to get signed URL for GCS URI:", error);
    alert(`Could not process document link (signed URL failed): ${error.message}.`);
    openNewWindow = false; // Don't open if GCS processing failed
  }
}

  // Append page number if it's a PDF and pageNumber is valid and we have a URL to open
  if (openNewWindow && isPdf && pageNumber && pageNumber !== 'N/A' && targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
    const pageNumInt = parseInt(pageNumber, 10);
    if (!isNaN(pageNumInt) && pageNumInt > 0) {
      // Check if URL already has a fragment
      const hashIndex = targetUrl.indexOf('#');
      if (hashIndex !== -1) {
        targetUrl = targetUrl.substring(0, hashIndex); // Remove existing fragment
      }
      targetUrl += `#page=${pageNumInt}`;
    }
  }
  
  if (openNewWindow && targetUrl) {
    //console.log("Opening URL:", targetUrl);
    window.open(targetUrl, '_blank');
  } else if (openNewWindow && !targetUrl) {
    // This case should ideally not be reached if uri was initially present
    console.error("No valid URL to open after processing.");
    alert("Could not open document: No valid URL found after processing.");
  }
};

const CitationIcon = ({ citation, onClick }) => (
  <span onClick={onClick} className="citation-icon" title={`View sources for citation ${citation.sources.map(s=>s.referenceId).join(', ')}`}>
    🔗
  </span>
);

const CitationReferencesDisplay = ({ citationDetails, allReferences }) => {
  if (!citationDetails || !citationDetails.sources || !allReferences || !Array.isArray(allReferences)) return null;

  const relevantReferences = citationDetails.sources.map(source => {
    const refId = parseInt(source.referenceId, 10);
    if (!isNaN(refId) && refId >= 0 && refId < allReferences.length) {
      return allReferences[refId];
    }
    console.warn(`Invalid referenceId: ${source.referenceId} or allReferences out of bounds.`);
    return null;
  }).filter(Boolean);

  if (relevantReferences.length === 0) {
    return <div className="citation-references-container"><p>No detailed references found for this citation's sources.</p></div>;
  }

  const numRelevantReferences = relevantReferences.length;
  // Base values for how many slides to show ideally
  const baseDesktopSlides = 3; // Changed to 3
  const baseTabletSlides = 2;  // Changed to 2
  const baseMobileSlides = 1;

  // Effective slides to show, cannot be more than available references
  // And must be at least 1 if there are any references.
  const effectiveDesktopSlides = numRelevantReferences > 0 ? Math.min(baseDesktopSlides, numRelevantReferences) : 1;
  const effectiveTabletSlides = numRelevantReferences > 0 ? Math.min(baseTabletSlides, numRelevantReferences) : 1;
  const effectiveMobileSlides = numRelevantReferences > 0 ? Math.min(baseMobileSlides, numRelevantReferences) : 1;
  
  const sliderSettings = {
    dots: numRelevantReferences > effectiveDesktopSlides, // Show dots if there's more than one "page"
    infinite: false, // Crucial for hiding arrows at ends
    speed: 500,
    slidesToShow: effectiveDesktopSlides,
    slidesToScroll: 1, // Scroll one by one for clarity
    arrows: true, // Always true; CSS hides them if slick-disabled
    adaptiveHeight: true, 
    responsive: [
      {
        breakpoint: 1024, // Tablet
        settings: {
          slidesToShow: effectiveTabletSlides,
          dots: numRelevantReferences > effectiveTabletSlides,
          // infinite: false and arrows: true are inherited
        }
      },
      {
        breakpoint: 600, // Mobile
        settings: {
          slidesToShow: effectiveMobileSlides,
          dots: numRelevantReferences > effectiveMobileSlides,
          // infinite: false and arrows: true are inherited
        }
      }
    ]
  };

  // If, after all calculations, slidesToShow is >= numRelevantReferences, no scrolling is possible.
  // react-slick with infinite:false and arrows:true should disable both arrows in this case.
  // The CSS rule for .slick-disabled will hide them.
  // We also might not want dots in this case.
  if (sliderSettings.slidesToShow >= numRelevantReferences) {
    sliderSettings.dots = false;
  }
  if (sliderSettings.responsive[0].settings.slidesToShow >= numRelevantReferences) {
    sliderSettings.responsive[0].settings.dots = false;
  }
  if (sliderSettings.responsive[1].settings.slidesToShow >= numRelevantReferences) {
    sliderSettings.responsive[1].settings.dots = false;
  }

  return (
    <div className="citation-references-container">
      <Slider {...sliderSettings}>
        {relevantReferences.map((ref, index) => {
          const doc = ref.document || ref.chunkInfo?.document || ref.chunkInfo?.documentMetadata;
          let rawLink = doc?.uri || doc?.name || '#';
          let fullLink = rawLink.startsWith('gs://') ? rawLink.replace('gs://', 'https://storage.cloud.google.com/') : rawLink;
          let displayLinkText = fullLink;
          try {
            const url = new URL(fullLink);
            const pathParts = url.pathname.split('/').filter(p => p);
            const lastPathPart = pathParts.pop() || '';
            displayLinkText = `${url.protocol}//${url.hostname}/.../${lastPathPart}`;
          } catch (e) { /* fallback */ }
          if (displayLinkText.length > 50) displayLinkText = displayLinkText.substring(0, 47) + "...";
          if (rawLink.length > 50 && displayLinkText === fullLink) displayLinkText = rawLink.substring(0,47) + "...";
          const title = doc?.title ||  'N/A';
          let snippet = ref.chunkInfo?.content || 'N/A';
          if (snippet.length > 100) snippet = snippet.substring(0, 97) + "...";
          const isPdf = (rawLink).toLowerCase().endsWith('.pdf');
          return (
            <div key={index}> 
              <div className="citation-reference-card">
                <div className="card-header">
                  {isPdf && <span className="pdf-icon">PDF</span>}
                  <a 
                    href={fullLink}
                    onClick={(e) => handleDocumentLinkClick(e, rawLink)} 
                    className="card-link" 
                    title={fullLink}
                  >
                    {displayLinkText}
                  </a>
                </div>
                <h5 className="card-title">{title}</h5>
                <p className="card-snippet">{snippet}</p>
              </div>
            </div>
          );
        })}
      </Slider>
    </div>
  );
};

const SearchBar = ({ initialValue, onSearch, onClear }) => {
  const [inputValue, setInputValue] = useState(initialValue || '');
  useEffect(() => { setInputValue(initialValue || ''); }, [initialValue]);
  const handleChange = (event) => setInputValue(event.target.value);
  const handleKeyPress = (event) => { if (event.key === 'Enter') onSearch(inputValue); };
  const handleClear = () => { setInputValue(''); if (onClear) onClear(); };
  return (
    <div className="search-bar-container">
      <input type="text" placeholder="세탁기 거름망 청소하는 법" value={inputValue} onChange={handleChange} onKeyPress={handleKeyPress} />
      {inputValue && <button onClick={handleClear}>X</button>}
    </div>
  );
};

const SearchResultItem = ({ result }) => {
  const pageNumForLink = (result.isPdf && result.pageNumber && result.pageNumber !== 'N/A') ? result.pageNumber : null;

  return (
    <div className="search-result-item">
      <a 
        href={result.link} // This is the base link, fragment is appended by handler
        onClick={(e) => handleDocumentLinkClick(e, result.gcsUriForSigning || result.link, pageNumForLink, result.isPdf)}
        target="_blank" 
        rel="noopener noreferrer"
      >
        {result.link} 
      </a>
      <div className="title-container">
        {result.isPdf && <span className="pdf-icon">PDF</span>}
        {result.isPptx && <span className="pptx-icon">PPTX</span>}
        <h3>{result.title}</h3>
        {result.isPdf && 
          <button 
            className="preview-icon" 
            onClick={() => result.onPreview(result.gcsUriForSigning || result.link, pageNumForLink)}
          >
            👁️
          </button>
        }
      </div>
      <div className="segment markdown-content"><Markdown>{String(result.segment)}</Markdown></div>
      <p className="page-number"><strong>Page {result.pageNumber}</strong></p>
    </div>
  );
};

const SearchResults = ({ results, onPreviewPdf }) => (
  <div className="search-results-container">
    {results.map((result, index) => ( <SearchResultItem key={index} result={{ ...result, onPreview: onPreviewPdf }} /> ))}
  </div>
);

const PdfPreviewOverlay = ({ pdfUrl, onClose }) => {
  useEffect(() => { if (pdfUrl) console.log("PdfPreviewOverlay: Attempting to load PDF from URL:", pdfUrl);}, [pdfUrl]);
  if (!pdfUrl) return null;
  return (
    <div className="pdf-preview-overlay">
      <div className="pdf-preview-content">
        <button className="close-button" onClick={onClose}>X</button>
        <iframe src={pdfUrl} title="PDF Preview" width="100%" height="100%" />
      </div>
    </div>
  );
};

const getCharOffsetFromByteOffset = (text, byteOffset) => {
  const encoder = new TextEncoder();
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    if (bytes === byteOffset) {
      return i;
    }
    const charCode = text.charCodeAt(i);
    let charToEncode = text[i];
    if (charCode >= 0xD800 && charCode <= 0xDBFF && i + 1 < text.length) {
      const nextCharCode = text.charCodeAt(i + 1);
      if (nextCharCode >= 0xDC00 && nextCharCode <= 0xDFFF) {
        charToEncode = text[i] + text[i+1];
      }
    }
    bytes += encoder.encode(charToEncode).length;
    if (bytes > byteOffset) { 
      return i;
    }
  }
  return text.length;
};

const StreamingResponse = ({ responseData, loading, onCitationClick, activeCitation }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef(null);
  const MAX_HEIGHT = 300;

  useEffect(() => { 
    const checkOverflow = () => {
      if (contentRef.current) {
        const currentMaxHeight = contentRef.current.style.maxHeight;
        contentRef.current.style.maxHeight = '';
        setIsOverflowing(contentRef.current.scrollHeight > MAX_HEIGHT);
        contentRef.current.style.maxHeight = currentMaxHeight;
      }
    };
    if (!loading && responseData && responseData.answerText) {
      const timer = setTimeout(checkOverflow, 100); 
      return () => clearTimeout(timer);
    } else {
      setIsOverflowing(false); setIsExpanded(false);
    }
  }, [responseData, loading, isExpanded]);

  const buildRenderableAnswer = () => {
    if (!responseData || !responseData.answerText) return null;
    const { answerText, citations } = responseData;

    if (!citations || citations.length === 0) {
      return <Markdown>{answerText}</Markdown>;
    }

    const elements = [];
    let lastCharIndex = 0; 
    
    const charCitations = citations.map(c => ({
        ...c,
        charStartIndex: getCharOffsetFromByteOffset(answerText, parseInt(c.startIndex)),
        charEndIndex: getCharOffsetFromByteOffset(answerText, parseInt(c.endIndex))
    })).sort((a, b) => a.charStartIndex - b.charStartIndex);

    charCitations.forEach((citation, i) => {
      const { charStartIndex, charEndIndex } = citation;
      if (charStartIndex > lastCharIndex) {
        elements.push(<Markdown key={`text-${i}-pre`}>{answerText.substring(lastCharIndex, charStartIndex)}</Markdown>);
      }
      elements.push(<Markdown key={`text-${i}-cited`} options={{ forceInline: true }}>{answerText.substring(charStartIndex, charEndIndex)}</Markdown>);
      elements.push(<CitationIcon key={`icon-${i}`} citation={citation} onClick={() => onCitationClick(citation)} />);
      
      // Compare based on unique charStartIndex and charEndIndex
      if (activeCitation && 
          activeCitation.charStartIndex === citation.charStartIndex &&
          activeCitation.charEndIndex === citation.charEndIndex) {
        elements.push(
          <CitationReferencesDisplay 
            key={`ref-display-${i}`} 
            citationDetails={activeCitation} 
            allReferences={responseData.allReferences} 
          />
        );
      }
      lastCharIndex = charEndIndex;
    });

    if (lastCharIndex < answerText.length) {
      elements.push(<Markdown key="text-final">{answerText.substring(lastCharIndex)}</Markdown>);
    }
    return elements;
  };
  
  const renderableContent = (!loading && responseData && responseData.answerText) ? buildRenderableAnswer() : null;

  return ( 
    <div className="streaming-response-container">
      {loading && ( 
        <div className="loading-indicator">
          <div className="sparkle-icon geni-ai-icon"></div><p>Generating...</p>
          <div className="new-progress-bar-animated"><div></div><div></div><div></div></div>
        </div>
      )}
      {!loading && responseData && (responseData.answerText || responseData.errorText) && (
        <>
          <div ref={contentRef} className="response-content markdown-content" style={{ maxHeight: (!isExpanded && isOverflowing) ? `${MAX_HEIGHT}px` : 'none' }}>
            {responseData.errorText ? responseData.errorText : renderableContent}
          </div>
          {isOverflowing && (
            <button onClick={() => setIsExpanded(!isExpanded)} className="show-more-less-button">
              {isExpanded ? <>Show less <span className="chevron up"></span></> : <>Show more <span className="chevron down"></span></>}
            </button>
          )}
        </>
      )}
    </div>
  );
};

function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const [streamingResponseData, setStreamingResponseData] = useState(null); 
  const [isLoadingResponse, setIsLoadingResponse] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [isLoadingSearchResults, setIsLoadingSearchResults] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState(null);
  const [activeCitation, setActiveCitation] = useState(null); 

  const processFinalAnswerChunk = (chunk) => { 
    if (chunk.answer && chunk.answer.state === "SUCCEEDED") {
      return {
        answerText: chunk.answer.answerText || "",
        citations: chunk.answer.citations || [],
        allReferences: chunk.answer.references || [] 
      };
    }
    return null;
  };
  
  const processStreamingAnswerTextChunk = (chunk, currentAccumulatedText) => { 
    let newText = currentAccumulatedText;
    // Accumulate text from answerChunk if available
    if (chunk.answer && chunk.answer.answerText && typeof chunk.answer.answerText === 'string') { 
      newText += chunk.answer.answerText; 
    }
    return newText;
  };

  const fetchStreamingAnswer = async (queryText) => { 
    setIsLoadingResponse(true);
    let initialAnswerTextProcessed = false; // Added flag
    setStreamingResponseData({ answerText: "", citations: [], allReferences: [], errorText: null });
    setActiveCitation(null);
    let lineBuffer = "";
    let currentAnswerText = "";
    let finalAnswerData = null; 

    const ANSWER_API_ENDPOINT = 'http://localhost:5001/api/answer';
    const requestBody = { query: queryText };
    try {
      const response = await fetch(ANSWER_API_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody)
      });
      if (!response.ok) { 
        let errorMsg = `Backend Answer API Error: ${response.status}`;
        try { const errorData = await response.json(); errorMsg = `Backend Answer API Error: ${errorData.error || JSON.stringify(errorData)}`; } catch (e) {}
        console.error(errorMsg); 
        setStreamingResponseData(prev => ({ ...prev, errorText: errorMsg }));
        return;
      }
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();


        while (true) {
          const { value: uint8ArrayChunk, done } = await reader.read();
          //console.log("Raw chunk received from stream:", { done, value: uint8ArrayChunk ? `Uint8Array of length ${uint8ArrayChunk.length}` : 'undefined' }); // Added log
          if (done) {
            if (lineBuffer.trim()) { 
              const jsonObjString = lineBuffer.trim();
              try {
                const streamChunk = JSON.parse(jsonObjString);
                if (streamChunk.answer?.state === "SUCCEEDED") {
                  finalAnswerData = processFinalAnswerChunk(streamChunk);
                } else { 
                  currentAnswerText = processStreamingAnswerTextChunk(streamChunk, currentAnswerText);
                }
              } catch (e) { console.error("Error parsing final answer chunk:", e, jsonObjString); }
            }
            break;
          }
          lineBuffer += decoder.decode(uint8ArrayChunk, { stream: true });
          let newlineIndex;
          while ((newlineIndex = lineBuffer.indexOf('\n')) >= 0) {
            const jsonObjString = lineBuffer.substring(0, newlineIndex).trim();
            lineBuffer = lineBuffer.substring(newlineIndex + 1);
            if (!jsonObjString) continue;
            try {
              const streamChunk = JSON.parse(jsonObjString);
              //console.log("Parsed streamChunk:", streamChunk); // Added log
              if (streamChunk.answer && typeof streamChunk.answer.answerText === 'string') { // Check specifically for answerText
                //console.log("streamChunk.answer.answerText received:", streamChunk.answer.answerText); // Log for streamChunk.answer.answerText
              }
              if (streamChunk.answer?.state === "SUCCEEDED") {
                finalAnswerData = processFinalAnswerChunk(streamChunk);
                // Ensure currentAnswerText reflects the final complete text
                if (finalAnswerData && typeof finalAnswerData.answerText === 'string') {
                  currentAnswerText = finalAnswerData.answerText;
                }
              } else { 
                //console.log("Accumulating: Before processStreamingAnswerTextChunk, currentAnswerText:", `"${currentAnswerText}"`);
                
                currentAnswerText = processStreamingAnswerTextChunk(streamChunk, currentAnswerText);
                //console.log("Accumulating: After processStreamingAnswerTextChunk, currentAnswerText:", `"${currentAnswerText}"`);
              }
              
              // --- Revised logic for initial text display and loading state ---
              if (!initialAnswerTextProcessed && currentAnswerText && currentAnswerText.length > 0) {
                //console.log("First text received. Setting loading to false. currentAnswerText:", currentAnswerText);
                setIsLoadingResponse(false); // Stop loading animation
                initialAnswerTextProcessed = true; // Mark as processed

                // Immediately set response data with the first piece of text
                // Ensure other fields are initialized correctly from the initial state or if finalAnswerData came with the first chunk
                if (streamChunk.answer?.state === "SUCCEEDED" && finalAnswerData) {
                    setStreamingResponseData(finalAnswerData); // First chunk was SUCCEEDED
                } else {
                    setStreamingResponseData(prev => ({ // First chunk was incremental
                        answerText: currentAnswerText,
                        citations: prev?.citations || [], // Carry over from initial state
                        allReferences: prev?.allReferences || [], // Carry over from initial state
                        errorText: prev?.errorText || null // Carry over from initial state
                    }));
                }
              } else if (initialAnswerTextProcessed) {
                // Subsequent updates after loading has already stopped
                if (streamChunk.answer?.state === "SUCCEEDED" && finalAnswerData) {
                  // Final SUCCEEDED chunk
                  setStreamingResponseData(finalAnswerData);
                } else {
                  // Incremental update, only update answerText
                  setStreamingResponseData(prev => ({
                    ...prev,
                    answerText: currentAnswerText
                  }));
                }
              }
              // If !initialAnswerTextProcessed and currentAnswerText is still empty,
              // no UI update for text yet; loading indicator remains.
              // --- End of revised logic ---
              await new Promise(resolve => setTimeout(resolve, 0)); 
              
            } catch (e) { console.error("Error parsing answer chunk:", e, jsonObjString); }
          }
        }

        // After the loop, a final state update might be needed if the last chunk processed
        // in the loop wasn't the SUCCEEDED one, or if the stream ended prematurely.
        // However, if finalAnswerData was set, it would have been applied in the loop's last iteration.
        // If the loop finishes and finalAnswerData is set, it means the SUCCEEDED chunk was the last one.
        // If finalAnswerData is NOT set, but currentAnswerText has content, it means stream ended before SUCCEEDED.
        if (!finalAnswerData && currentAnswerText) {
          setStreamingResponseData(prev => ({
            ...prev,
            answerText: currentAnswerText,
            errorText: prev?.errorText // Preserve existing error or set new one if needed
          }));
        } else if (!finalAnswerData && !currentAnswerText) {
          // If stream ends, no final data, no accumulated text (e.g. error or empty stream)
          // Ensure an error message is present if not already.
          setStreamingResponseData(prev => {
            if (prev && prev.errorText) return prev; // Keep existing error
            return { answerText: "", citations: [], allReferences: [], errorText: "No answer content received." };
          });
        }
        // If finalAnswerData was set and processed in the loop, no special post-loop action is needed for it.
      }
    } catch (error) { 
        console.error('Network error fetching streaming answer:', error); 
        setStreamingResponseData(prev => ({...(prev||{}), errorText: `Frontend Error: ${error.message}`}));
    } finally { 
      // --- Modification Start: Conditional setIsLoadingResponse ---
      if (!initialAnswerTextProcessed) {
        setIsLoadingResponse(false); 
      }
      // --- Modification End ---
    }
  };

  const fetchDocumentSearchResults = async (queryText) => { 
    setIsLoadingSearchResults(true); 
    setSearchResults([]);
    const SEARCH_API_ENDPOINT = 'http://localhost:5001/api/search';
    const requestBody = { query: queryText };
    try {
      const response = await fetch(SEARCH_API_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody)
      });
      if (!response.ok) { 
        let errorMsg = `Backend Search API Error: ${response.status} ${response.statusText}`;
        try { const errorData = await response.json(); errorMsg = `Backend Answer API Error: ${errorData.error || JSON.stringify(errorData)}`; } catch (e) {}
        console.error(errorMsg); return;
      }
      const data = await response.json();
      if (data.results && Array.isArray(data.results)) {
        const formattedResults = data.results.map(item => {
          const doc = item.document; const derivedData = doc?.derivedStructData;
          const extractiveAnswer = derivedData?.extractive_answers?.[0];
          let originalUri = doc?.uri || derivedData?.link || '#';
          let gcsUriForSigning = originalUri.startsWith('gs://') ? originalUri : null;
          let displayLink = originalUri;
          if (gcsUriForSigning) {
            displayLink = originalUri.replace('gs://', 'https://storage.cloud.google.com/');
          }
          return {
            link: displayLink,
            gcsUriForSigning: gcsUriForSigning,
            title: derivedData?.title || doc?.name?.split('/').pop() || 'Search Result',
            segment: extractiveAnswer?.content || derivedData?.snippets?.[0]?.snippet || 'No segment available.', 
            pageNumber: extractiveAnswer?.pageNumber || 'N/A',
            isPdf: (originalUri).toLowerCase().endsWith('.pdf'), 
            isPptx: (originalUri).toLowerCase().endsWith('.pptx'),
          };
        });
        setSearchResults(formattedResults);
      } else console.log("No search results found or unexpected format:", data);
    } catch (error) { console.error('Network error fetching search results:', error);
    } finally { setIsLoadingSearchResults(false); }
  };

  const handleSearch = (query) => { 
    if (query.trim() === '') return;
    fetchStreamingAnswer(query);
    fetchDocumentSearchResults(query);
  };
  useEffect(() => {}, []);
  const handleSearchSubmit = (query) => { setSearchTerm(query); handleSearch(query); };
  const handleClearSearch = () => { setSearchTerm(''); setStreamingResponseData(null); setSearchResults([]); setActiveCitation(null); };
  const handleCitationClick = (clickedCitation) => { 
    // Compare based on unique charStartIndex and charEndIndex
    if (activeCitation && 
        activeCitation.charStartIndex === clickedCitation.charStartIndex &&
        activeCitation.charEndIndex === clickedCitation.charEndIndex) {
      setActiveCitation(null); 
    } else {
      setActiveCitation(clickedCitation); 
    }
  };

  const handlePreviewPdf = async (uri, pageNumber) => {
    let targetUrl = uri;
    let success = true;

    if (uri && uri.startsWith('gs://')) {
      //console.log(`Requesting signed URL for PDF preview: ${uri}, page: ${pageNumber}`);
      try {
        const response = await fetch('http://localhost:5001/api/generate-signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gcs_uri: uri })
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`Backend error for PDF preview: ${errorData.error || response.status}`);
        }
        const data = await response.json();
        if (data.signedUrl) {
          targetUrl = data.signedUrl;
        } else {
          throw new Error("No signedUrl received for PDF preview.");
        }
      } catch (error) {
        console.error("Failed to get signed URL for PDF preview:", error);
        alert(`Could not load PDF preview (signed URL failed): ${error.message}.`);
        success = false;
      }
    }
    
    if (success && targetUrl) {
      // Append page number if it's a PDF (implicit, as this handler is for PDFs) and pageNumber is valid
      if (pageNumber && pageNumber !== 'N/A' && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
        const pageNumInt = parseInt(pageNumber, 10);
        if (!isNaN(pageNumInt) && pageNumInt > 0) {
          const hashIndex = targetUrl.indexOf('#');
          if (hashIndex !== -1) {
            targetUrl = targetUrl.substring(0, hashIndex); // Remove existing fragment
          }
          targetUrl += `#page=${pageNumInt}`;
        }
      }
      //console.log("Setting PDF preview URL to:", targetUrl);
      setPreviewPdfUrl(targetUrl);
    } else {
      setPreviewPdfUrl(null); // Clear preview on error or no URI
    }
  };
  const handleClosePdfPreview = () => { setPreviewPdfUrl(null); };

  return ( 
    <div className="App">
      <header className="App-header">
        <SearchBar initialValue={searchTerm} onSearch={handleSearchSubmit} onClear={handleClearSearch} />
      </header>
      <main>
        <StreamingResponse 
          responseData={streamingResponseData} 
          loading={isLoadingResponse} 
          onCitationClick={handleCitationClick}
          activeCitation={activeCitation}
        />
        {isLoadingSearchResults && <p>Loading search results...</p>}
        {!isLoadingSearchResults && searchResults.length > 0 && <SearchResults results={searchResults} onPreviewPdf={handlePreviewPdf} />}
        {!isLoadingSearchResults && searchResults.length === 0 && !isLoadingResponse && 
          (!streamingResponseData || (!streamingResponseData.answerText && !streamingResponseData.errorText)) && 
          <p>No results to display.</p>
        }
      </main>
      <PdfPreviewOverlay pdfUrl={previewPdfUrl} onClose={handleClosePdfPreview} />
    </div>
  );
}

export default App;
