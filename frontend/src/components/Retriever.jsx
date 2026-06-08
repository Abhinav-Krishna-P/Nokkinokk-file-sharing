import React, { useState, useEffect, useRef } from 'react';
import { 
  Download, FileText, Link2, Shield, AlertTriangle, Clock, 
  Copy, Check, File, Image, Film, FileAudio, ExternalLink 
} from 'lucide-react';

const isSafeUrl = (urlString) => {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
};

function Retriever() {
  const [pinDigits, setPinDigits] = useState(['', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [shareData, setShareData] = useState(null); // { type, expiresAt, data }
  
  const [timeLeft, setTimeLeft] = useState('');
  const [copiedText, setCopiedText] = useState(false);
  
  const inputRefs = [useRef(), useRef(), useRef(), useRef(), useRef()];

  // Auto-fill from URL search params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlPin = params.get('pin');
    if (urlPin && urlPin.length === 5) {
      const digits = urlPin.toUpperCase().split('');
      setPinDigits(digits);
      triggerRetrieve(urlPin);
    }
  }, []);

  // Sync remaining time ticker
  useEffect(() => {
    if (!shareData) return;

    const timer = setInterval(() => {
      const difference = new Date(shareData.expiresAt).getTime() - Date.now();
      if (difference <= 0) {
        setTimeLeft('Expired');
        setShareData(null);
        setError('The shared resources have expired.');
        clearInterval(timer);
      } else {
        const minutes = Math.floor((difference / 1000 / 60) % 60);
        const seconds = Math.floor((difference / 1000) % 60);
        const hours = Math.floor((difference / (1000 * 60 * 60)) % 24);
        
        let displayStr = '';
        if (hours > 0) displayStr += `${hours}h `;
        displayStr += `${minutes}m ${seconds}s`;
        
        setTimeLeft(displayStr);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [shareData]);

  // Handle digit inputs
  const handleDigitChange = (index, value) => {
    // Keep only alphanumeric and force uppercase
    const cleanValue = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!cleanValue) {
      const newDigits = [...pinDigits];
      newDigits[index] = '';
      setPinDigits(newDigits);
      return;
    }

    const lastChar = cleanValue.slice(-1);
    const newDigits = [...pinDigits];
    newDigits[index] = lastChar;
    setPinDigits(newDigits);

    // Auto-focus next box
    if (index < 4) {
      inputRefs[index + 1].current.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    // Handle backspace back-focus
    if (e.key === 'Backspace') {
      if (!pinDigits[index] && index > 0) {
        const newDigits = [...pinDigits];
        newDigits[index - 1] = '';
        setPinDigits(newDigits);
        inputRefs[index - 1].current.focus();
      } else {
        const newDigits = [...pinDigits];
        newDigits[index] = '';
        setPinDigits(newDigits);
      }
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (pastedData.length === 5) {
      const digits = pastedData.split('');
      setPinDigits(digits);
      // Blur inputs
      inputRefs[4].current.blur();
      triggerRetrieve(pastedData);
    }
  };

  const triggerRetrieve = async (pinCode) => {
    setError('');
    setIsLoading(true);
    setShareData(null);

    try {
      const res = await fetch(`/api/share/retrieve/${pinCode}`);
      const result = await res.json();
      
      setIsLoading(false);
      if (res.ok && result.success) {
        setShareData({
          type: result.type,
          expiresAt: result.expiresAt,
          data: result.data
        });
      } else {
        setError(result.message || 'Verification failed. Try again.');
      }
    } catch (err) {
      setIsLoading(false);
      setError('Connection refused. Is the server running?');
    }
  };

  const handleManualRetrieve = () => {
    const pinCode = pinDigits.join('');
    if (pinCode.length !== 5) {
      setError('Please enter all 5 digits of your PIN.');
      return;
    }
    triggerRetrieve(pinCode);
  };

  const handleClear = () => {
    setPinDigits(['', '', '', '', '']);
    setShareData(null);
    setError('');
    // Remove query parameter from URL bar without reloading
    const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.pushState({ path: newurl }, '', newurl);
  };

  const handleCopyText = () => {
    if (!shareData || !shareData.data.content) return;
    navigator.clipboard.writeText(shareData.data.content);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const getFileIcon = (mimeType) => {
    if (mimeType.startsWith('image/')) return <Image size={24} style={{ color: 'var(--color-secondary)' }} />;
    if (mimeType.startsWith('video/')) return <Film size={24} style={{ color: 'var(--color-accent)' }} />;
    if (mimeType.startsWith('audio/')) return <FileAudio size={24} style={{ color: 'var(--color-success)' }} />;
    return <File size={24} style={{ color: 'var(--text-secondary)' }} />;
  };

  return (
    <div className="glass-panel retrieve-card">
      <h2 className="panel-title">
        <Shield size={22} /> Access Content
      </h2>

      {!shareData ? (
        <>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Enter the 5-digit PIN received from the sender to download files, copy text snippets, or view links.
          </p>

          {error && (
            <div className="alert-box error">
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          )}

          {/* 5 digit split PIN Input boxes */}
          <div className="pin-inputs-grid" onPaste={handlePaste}>
            {pinDigits.map((digit, idx) => (
              <input
                key={idx}
                type="text"
                maxLength={2} // Allows overwriting and pasting
                value={digit}
                ref={inputRefs[idx]}
                onChange={(e) => handleDigitChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                disabled={isLoading}
                className="pin-box"
                autoComplete="off"
              />
            ))}
          </div>

          <button 
            className="btn-primary" 
            onClick={handleManualRetrieve}
            disabled={isLoading || pinDigits.some(d => d === '')}
          >
            {isLoading ? 'Retrieving...' : 'Verify & Retrieve'}
          </button>
        </>
      ) : (
        /* Content Display Output Panel */
        <div className="retrieved-container">
          <div className="retrieved-meta">
            <div className="retrieved-type-badge">
              {shareData.type === 'files' && <File size={16} />}
              {shareData.type === 'text' && <FileText size={16} />}
              {shareData.type === 'link' && <Link2 size={16} />}
              <span>{shareData.type} Shared</span>
            </div>

            <div className="countdown-box" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
              <Clock size={12} />
              <span>Expiry: <strong>{timeLeft || 'Checking...'}</strong></span>
            </div>
          </div>

          {/* Text Content display */}
          {shareData.type === 'text' && (
            <div>
              <div className="content-display-box" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                <pre className="retrieved-text">{shareData.data.content}</pre>
              </div>
              <button className="btn-primary" onClick={handleCopyText}>
                {copiedText ? (
                  <>
                    <Check size={18} /> Copied!
                  </>
                ) : (
                  <>
                    <Copy size={18} /> Copy Content
                  </>
                )}
              </button>
            </div>
          )}

          {/* Link Content display */}
          {shareData.type === 'link' && (
            <div className="content-display-box retrieved-link-container">
              <Link2 size={36} style={{ color: 'var(--color-primary)', marginBottom: '0.5rem' }} />
              <p className="file-name" style={{ marginBottom: '1.5rem', fontSize: '1rem', wordBreak: 'break-all' }}>
                {shareData.data.url}
              </p>
              {isSafeUrl(shareData.data.url) ? (
                <a 
                  href={shareData.data.url} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="link-button"
                >
                  Open Shared Link <ExternalLink size={16} />
                </a>
              ) : (
                <div className="alert-box error" style={{ margin: '1rem 0 0 0', width: '100%' }}>
                  <AlertTriangle size={18} />
                  <span>Blocked: Unsafe URL protocol detected.</span>
                </div>
              )}
            </div>
          )}

          {/* Files List display */}
          {shareData.type === 'files' && (
            <div className="download-grid">
              {shareData.data.files && shareData.data.files.map((file) => (
                <div className="download-item" key={file.id}>
                  <div className="file-info">
                    {getFileIcon(file.mime_type)}
                    <div className="file-details">
                      <span className="file-name" title={file.original_name}>{file.original_name}</span>
                      <span className="file-size">{(file.file_size / (1024 * 1024)).toFixed(2)} MB</span>
                    </div>
                  </div>
                  <a 
                    href={`/api/share/download/${file.id}?pin=${pinDigits.join('')}`}
                    download
                    className="btn-download"
                    style={{ textDecoration: 'none' }}
                  >
                    <Download size={14} /> Download
                  </a>
                </div>
              ))}
            </div>
          )}

          <div className="btn-back-container" style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '1.5rem' }}>
            <button className="btn-secondary" onClick={handleClear} style={{ width: '100%', justifyContent: 'center' }}>
              Access Another PIN
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Retriever;
