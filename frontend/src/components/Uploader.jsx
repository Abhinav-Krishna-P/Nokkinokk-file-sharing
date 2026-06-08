import React, { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import { 
  Upload, FileText, Link2, Clock, Check, Copy, AlertTriangle, 
  Trash2, File, Image, Film, FileAudio, ExternalLink, RefreshCw 
} from 'lucide-react';

const MAX_FILE_SIZE_BYTES = 80 * 1024 * 1024; // 80 MB

function Uploader() {
  const [activeTab, setActiveTab] = useState('files'); // 'files' | 'text'
  const [files, setFiles] = useState([]);
  const [textContent, setTextContent] = useState('');
  
  // Status states
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [successData, setSuccessData] = useState(null); // { pin, expiresAt }
  
  // UI states
  const [isDragging, setIsDragging] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');
  
  const fileInputRef = useRef(null);
  const qrCanvasRef = useRef(null);

  // File type icons helper
  const getFileIcon = (mimeType) => {
    if (mimeType.startsWith('image/')) return <Image size={20} />;
    if (mimeType.startsWith('video/')) return <Film size={20} />;
    if (mimeType.startsWith('audio/')) return <FileAudio size={20} />;
    return <File size={20} />;
  };

  // Drag and Drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
  };

  const addFiles = (newFiles) => {
    setErrorMessage('');
    
    // Calculate total size including existing files
    const currentTotalSize = files.reduce((sum, f) => sum + f.size, 0);
    const addedTotalSize = newFiles.reduce((sum, f) => sum + f.size, 0);
    
    if (currentTotalSize + addedTotalSize > MAX_FILE_SIZE_BYTES) {
      setErrorMessage(`Total size exceeds the 80MB limit. Selected: ${((currentTotalSize + addedTotalSize) / (1024 * 1024)).toFixed(2)} MB`);
      return;
    }

    setFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setErrorMessage('');
  };

  // Expiration countdown effect
  useEffect(() => {
    if (!successData) return;

    const timer = setInterval(() => {
      const difference = new Date(successData.expiresAt).getTime() - Date.now();
      if (difference <= 0) {
        setTimeLeft('Expired');
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
  }, [successData]);

  // QR Code generator effect
  useEffect(() => {
    if (successData && qrCanvasRef.current) {
      // Create a direct retrieve link on the current host
      const shareUrl = `${window.location.origin}?pin=${successData.pin}`;
      QRCode.toCanvas(qrCanvasRef.current, shareUrl, {
        width: 140,
        margin: 1.5,
        color: {
          dark: '#0a0b10',
          light: '#ffffff'
        }
      }, (err) => {
        if (err) console.error('Error drawing QR Code:', err);
      });
    }
  }, [successData]);

  // Copy helpers
  const handleCopyPIN = () => {
    if (!successData) return;
    navigator.clipboard.writeText(successData.pin);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const handleCopyLink = () => {
    if (!successData) return;
    const shareUrl = `${window.location.origin}?pin=${successData.pin}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleReset = () => {
    setFiles([]);
    setTextContent('');
    setSuccessData(null);
    setUploadProgress(0);
    setErrorMessage('');
  };

  // Core Upload Logic
  const handleUploadSubmit = () => {
    setErrorMessage('');
    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('type', activeTab);

    if (activeTab === 'text') {
      formData.append('content', textContent);
    } else if (activeTab === 'files') {
      if (files.length === 0) {
        setErrorMessage('Please add at least one file.');
        setIsUploading(false);
        return;
      }
      files.forEach((file) => {
        formData.append('files', file);
      });
    }

    // Use native XMLHttpRequest to support upload progress monitoring
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/share/upload', true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percentComplete = Math.round((e.loaded / e.total) * 100);
        setUploadProgress(percentComplete);
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      try {
        const response = JSON.parse(xhr.responseText);
        if (xhr.status === 201 && response.success) {
          setSuccessData({
            pin: response.pin,
            expiresAt: response.expiresAt,
            type: response.type
          });
        } else {
          setErrorMessage(response.message || 'Upload failed. Please check file properties.');
        }
      } catch (err) {
        setErrorMessage('Failed to parse server response.');
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      setErrorMessage('Network connection lost or server is offline.');
    };

    xhr.send(formData);
  };

  return (
    <div className="glass-panel upload-card">
      <h2 className="panel-title">
        <Upload size={22} /> Share Content
      </h2>

      {!successData ? (
        <>
          {/* Content Type Tabs */}
          <div className="tab-container">
            <button 
              className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`}
              onClick={() => { setActiveTab('files'); setErrorMessage(''); }}
              disabled={isUploading}
            >
              <Upload size={16} /> Files
            </button>
            <button 
              className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
              onClick={() => { setActiveTab('text'); setErrorMessage(''); }}
              disabled={isUploading}
            >
              <FileText size={16} /> Text
            </button>
          </div>

          {errorMessage && (
            <div className="alert-box error">
              <AlertTriangle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Tab Views */}
          {activeTab === 'files' && (
            <div>
              <div 
                className={`drop-zone ${isDragging ? 'dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !isUploading && fileInputRef.current.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  style={{ display: 'none' }} 
                  multiple 
                  onChange={handleFileSelect}
                  disabled={isUploading}
                />
                <div className="drop-icon">
                  <Upload size={32} />
                </div>
                <p className="drop-text">
                  Drag & Drop files or <span>Browse</span>
                </p>
                <p className="drop-subtext">Supports images, documents, videos (Max 80MB total)</p>
              </div>

              {files.length > 0 && (
                <div className="file-list">
                  {files.map((file, idx) => (
                    <div className="file-item" key={idx}>
                      <div className="file-info">
                        {getFileIcon(file.type)}
                        <div className="file-details">
                          <span className="file-name">{file.name}</span>
                          <span className="file-size">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                        </div>
                      </div>
                      <button 
                        className="remove-file-btn" 
                        onClick={() => removeFile(idx)}
                        disabled={isUploading}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'text' && (
            <div className="text-area-container">
              <label className="input-label">Text Content</label>
              <textarea
                className="app-textarea"
                placeholder="Paste or type text snippet to share..."
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                disabled={isUploading}
              />
            </div>
          )}



          {/* Submit Action */}
          <div className="action-controls" style={{ marginTop: '2rem' }}>
            <div className="submit-container" style={{ width: '100%' }}>
              <button 
                className="btn-primary" 
                onClick={handleUploadSubmit}
                disabled={
                  isUploading || 
                  (activeTab === 'files' && files.length === 0) ||
                  (activeTab === 'text' && !textContent.trim())
                }
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="animate-spin" size={18} style={{ animation: 'spin 2s linear infinite' }} />
                    Uploading...
                  </>
                ) : (
                  'Share Now'
                )}
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {isUploading && (
            <div className="progress-container animate-fade-in">
              <div className="progress-header">
                <span>Sending payload...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${uploadProgress}%` }}></div>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Upload Success Output Panel */
        <div className="share-result">
          <div className="alert-box success">
            <Check size={18} />
            <span>Uploaded Successfully!</span>
          </div>

          {/* 5-Digit PIN code block */}
          <div className="pin-display-container">
            <h3 className="pin-title">Enter this code to access</h3>
            <div className="pin-code-group">
              <span className="pin-code">{successData.pin}</span>
              <button className="btn-icon-only" onClick={handleCopyPIN} title="Copy PIN">
                {copiedText ? <Check size={18} style={{ color: 'var(--color-success)' }} /> : <Copy size={18} />}
              </button>
            </div>
          </div>

          {/* Complete shareable URL link */}
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
            <span className="input-label">Direct Retrieve Link</span>
            <div className="link-view-group">
              <span className="link-input">{`${window.location.origin}?pin=${successData.pin}`}</span>
              <button className="btn-icon-only" onClick={handleCopyLink} style={{ borderRadius: '8px', width: '2.5rem', height: '2.5rem' }} title="Copy Link">
                {copiedLink ? <Check size={16} style={{ color: 'var(--color-success)' }} /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          {/* Autogenerated QR code canvas */}
          <div style={{ margin: '0.5rem 0' }}>
            <span className="input-label" style={{ display: 'block', marginBottom: '0.5rem' }}>Scan QR Code</span>
            <div className="qr-container">
              <canvas ref={qrCanvasRef}></canvas>
            </div>
          </div>

          {/* Countdown Clock Display */}
          <div className="countdown-box">
            <Clock size={16} />
            <span>Deletes in: <strong>{timeLeft || 'Calculating...'}</strong></span>
          </div>

          <div className="btn-back-container" style={{ width: '100%' }}>
            <button className="btn-secondary" onClick={handleReset} style={{ width: '100%', justifyContent: 'center' }}>
              Share Another Resource
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Uploader;
