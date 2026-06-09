import React, { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import io from 'socket.io-client';
import { 
  Upload, FileText, Link2, Clock, Check, Copy, AlertTriangle, 
  Trash2, File, Image, Film, FileAudio, ExternalLink, RefreshCw, Zap, Wifi
} from 'lucide-react';

const STANDARD_MAX_SIZE = 100 * 1024 * 1024; // 100 MB
const P2P_MAX_SIZE = 50 * 1024 * 1024 * 1024; // 50 GB

function Uploader() {
  const [mode, setMode] = useState('standard'); // 'standard' | 'p2p'
  const [activeTab, setActiveTab] = useState('files'); // 'files' | 'text'
  const [files, setFiles] = useState([]);
  const [textContent, setTextContent] = useState('');
  
  // Status states
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [successData, setSuccessData] = useState(null); // { pin, expiresAt, type }
  
  // P2P states
  const [isP2PSharing, setIsP2PSharing] = useState(false);
  const [p2pStatus, setP2PStatus] = useState('idle'); // 'idle' | 'registering' | 'waiting-for-receiver' | 'connecting' | 'transferring' | 'completed' | 'error'
  const [p2pProgress, setP2PProgress] = useState(0);
  const [p2pSpeed, setP2PSpeed] = useState('0.00');
  const [p2pCurrentFile, setP2pCurrentFile] = useState('');

  // UI states
  const [isDragging, setIsDragging] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');
  
  const fileInputRef = useRef(null);
  const qrCanvasRef = useRef(null);

  // P2P refs
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const lastTimeRef = useRef(Date.now());
  const lastBytesRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const isReconnectingRef = useRef(false);
  const iceCandidatesQueue = useRef([]);

  const maxFileSizeLimit = mode === 'standard' ? STANDARD_MAX_SIZE : P2P_MAX_SIZE;

  // File type icons helper
  const getFileIcon = (mimeType) => {
    if (!mimeType) return <File size={20} />;
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
    
    if (currentTotalSize + addedTotalSize > maxFileSizeLimit) {
      const displayLimit = mode === 'standard' ? '100 MB' : '50 GB';
      const selectedSizeMB = ((currentTotalSize + addedTotalSize) / (1024 * 1024)).toFixed(2);
      setErrorMessage(`Total size exceeds the ${displayLimit} limit. Selected: ${selectedSizeMB} MB`);
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

  // Cleanup WebRTC connections
  const cleanupPeerConnection = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close();
      } catch (e) {}
      dataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (e) {}
      peerConnectionRef.current = null;
    }
  };

  const handleReset = () => {
    cleanupPeerConnection();
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    isReconnectingRef.current = false;
    setFiles([]);
    setTextContent('');
    setSuccessData(null);
    setUploadProgress(0);
    setErrorMessage('');
    setIsP2PSharing(false);
    setP2PStatus('idle');
    setP2pCurrentFile('');
    setP2PProgress(0);
    setP2PSpeed('0.00');
  };

  // P2P Share Start Logic
  const startP2PShare = () => {
    if (files.length === 0) {
      setErrorMessage('Please add at least one file to share.');
      return;
    }

    setErrorMessage('');
    setIsP2PSharing(true);
    setP2PStatus('registering');
    setP2PProgress(0);
    setP2PSpeed('0.00');
    setP2pCurrentFile('');

    // Connect to Backend WebSocket
    const socket = io({
      transports: ['websocket']
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to signaling server');
      const filesMeta = files.map(f => ({
        name: f.name,
        size: f.size,
        type: f.type
      }));
      socket.emit('register-p2p', { files: filesMeta });
    });

    socket.on('p2p-registered', ({ pin, expiresAt }) => {
      setP2PStatus('waiting-for-receiver');
      setSuccessData({
        pin,
        expiresAt,
        type: 'p2p'
      });
    });

    socket.on('receiver-joined', ({ receiverSocketId }) => {
      setP2PStatus('connecting');
      initiateWebRTCConnection(receiverSocketId);
    });

    socket.on('receiver-reconnected', ({ receiverSocketId }) => {
      console.log('Receiver reconnected:', receiverSocketId);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setP2PStatus('connecting');
      initiateWebRTCConnection(receiverSocketId);
    });

    socket.on('p2p-signal', async ({ signal }) => {
      const pc = peerConnectionRef.current;
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          // Process any queued ICE candidates
          const queued = iceCandidatesQueue.current;
          iceCandidatesQueue.current = [];
          for (const cand of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (err) {
              console.error('Error adding queued ICE candidate:', err);
            }
          }
        } catch (err) {
          console.error('Error setting remote description:', err);
        }
      }
    });

    socket.on('p2p-ice-candidate', async ({ candidate }) => {
      const pc = peerConnectionRef.current;
      if (pc) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.error('Error adding ICE candidate:', err);
          }
        } else {
          console.log('Queueing ICE candidate (remote description not set yet)');
          iceCandidatesQueue.current.push(candidate);
        }
      }
    });

    socket.on('receiver-disconnected', () => {
      console.log('Receiver disconnected');
      
      // If actively transferring, enter reconnecting state
      if (isP2PSharing && p2pStatus === 'transferring') {
        isReconnectingRef.current = true;
        setP2PStatus('reconnecting');
        
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          setErrorMessage('Connection timed out. Receiver did not reconnect.');
          handleReset();
        }, 30000);
      } else {
        setErrorMessage('Receiver disconnected. Re-waiting for connection...');
        setP2PStatus('waiting-for-receiver');
        cleanupPeerConnection();
      }
    });

    socket.on('p2p-error', ({ message }) => {
      setErrorMessage(message);
      setP2PStatus('error');
      setIsP2PSharing(false);
    });

    socket.on('disconnect', () => {
      console.log('Signaling socket disconnected');
    });
  };

  // WebRTC Sender Connection Handshake
  const initiateWebRTCConnection = async (receiverSocketId) => {
    // Clear old peer connection, but keep reconnect timers active
    if (dataChannelRef.current) {
      try { dataChannelRef.current.close(); } catch (e) {}
      dataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      try { peerConnectionRef.current.close(); } catch (e) {}
      peerConnectionRef.current = null;
    }

    iceCandidatesQueue.current = [];

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    });
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('p2p-ice-candidate', {
          targetSocketId: receiverSocketId,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('WebRTC Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        // We will transition to transferring when the resume-request arrives, or inside here if it was a fresh start
        if (!isReconnectingRef.current) {
          setP2PStatus('transferring');
        }
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        if (isP2PSharing && p2pStatus === 'transferring') {
          isReconnectingRef.current = true;
          setP2PStatus('reconnecting');
          
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            setErrorMessage('P2P connection lost. Reconnection timed out.');
            handleReset();
          }, 30000);
        } else {
          setErrorMessage('Direct P2P connection failed or lost.');
          setP2PStatus('waiting-for-receiver');
          cleanupPeerConnection();
        }
      }
    };

    // Create the DataChannel for binary files
    const dc = pc.createDataChannel('file-transfer', { ordered: true });
    dataChannelRef.current = dc;

    dc.onopen = () => {
      console.log('Data channel opened');
      lastTimeRef.current = Date.now();
      lastBytesRef.current = 0;
      
      // If we are NOT reconnecting, start sending normally from 0
      if (!isReconnectingRef.current) {
        setP2PStatus('transferring');
        startSendingFiles(dc, receiverSocketId, 0, 0);
      }
    };

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'resume-request') {
          console.log(`Resuming file ${msg.fileName} from offset ${msg.offset}`);
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          isReconnectingRef.current = false;
          setP2PStatus('transferring');
          
          const fileIndex = files.findIndex(f => f.name === msg.fileName);
          startSendingFiles(dc, receiverSocketId, fileIndex >= 0 ? fileIndex : 0, msg.offset);
        }
      } catch (err) {
        console.error('Failed parsing channel message:', err);
      }
    };

    dc.onclose = () => {
      console.log('Data channel closed');
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit('p2p-signal', {
        targetSocketId: receiverSocketId,
        signal: offer
      });
    } catch (err) {
      console.error('Failed to create offer:', err);
      setErrorMessage('Failed to negotiate peer connection.');
      setP2PStatus('error');
    }
  };

  // Send files in chunks with Backpressure check
  const startSendingFiles = async (dc, receiverSocketId, startFileIndex = 0, startOffset = 0) => {
    let currentFileIndex = startFileIndex;

    const sendFile = () => {
      if (isReconnectingRef.current) {
        console.log('Transmission paused: waiting for reconnection.');
        return;
      }

      if (currentFileIndex >= files.length) {
        console.log('All files sent successfully');
        setP2PStatus('completed');
        try {
          dc.send(JSON.stringify({ type: 'all-completed' }));
        } catch (e) {}
        return;
      }

      const file = files[currentFileIndex];
      setP2pCurrentFile(file.name);

      // Only send the start metadata if we are starting a file from offset 0
      if (startOffset === 0) {
        try {
          dc.send(JSON.stringify({
            type: 'start',
            name: file.name,
            size: file.size,
            mime: file.type
          }));
        } catch (err) {
          console.error('Failed to send start header:', err);
          return;
        }
      }

      const CHUNK_SIZE = 64 * 1024; // 64 KB
      let offset = startOffset;
      // Reset startOffset so next files start from offset 0
      startOffset = 0;

      const reader = new FileReader();

      const readNextSlice = () => {
        if (isReconnectingRef.current) {
          console.log('Slicing paused due to reconnection.');
          return;
        }

        if (offset >= file.size) {
          try {
            dc.send(JSON.stringify({ type: 'end', name: file.name }));
          } catch (e) {}
          currentFileIndex++;
          setTimeout(sendFile, 400); // 400ms delay between files
          return;
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        reader.readAsArrayBuffer(slice);
      };

      reader.onload = (event) => {
        if (isReconnectingRef.current) return;
        const buffer = event.target.result;

        // Check if data channel buffer is full (exceeds 1 MB)
        if (dc.bufferedAmount > 1024 * 1024) {
          dc.onbufferedamountlow = () => {
            dc.onbufferedamountlow = null;
            if (isReconnectingRef.current) return;
            try {
              dc.send(buffer);
              offset += buffer.byteLength;
              updateP2PProgress(offset, file.size, currentFileIndex);
              readNextSlice();
            } catch (err) {
              console.error('Data channel send error:', err);
            }
          };
        } else {
          try {
            dc.send(buffer);
            offset += buffer.byteLength;
            updateP2PProgress(offset, file.size, currentFileIndex);
            readNextSlice();
          } catch (err) {
            console.error('Data channel send error:', err);
          }
        }
      };

      readNextSlice();
    };

    sendFile();
  };

  const updateP2PProgress = (fileOffset, fileSize, fileIndex) => {
    const totalBytesSentBeforeThisFile = files
      .slice(0, fileIndex)
      .reduce((sum, f) => sum + f.size, 0);
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    const totalSent = totalBytesSentBeforeThisFile + fileOffset;
    
    const percent = Math.min(100, Math.round((totalSent / totalBytes) * 100));
    setP2PProgress(percent);

    // Calculate throughput speed
    const now = Date.now();
    const duration = (now - lastTimeRef.current) / 1000;
    if (duration >= 0.5) {
      const bytesSentDiff = totalSent - lastBytesRef.current;
      const speedMBPerSec = (bytesSentDiff / duration) / (1024 * 1024);
      setP2PSpeed(speedMBPerSec.toFixed(2));
      
      lastTimeRef.current = now;
      lastBytesRef.current = totalSent;
    }
  };

  // Core Upload Logic
  const handleUploadSubmit = () => {
    if (mode === 'p2p') {
      startP2PShare();
      return;
    }

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

  // Check if we are in active P2P transmission
  const isP2PActive = isP2PSharing && successData;

  return (
    <div className="glass-panel upload-card">
      <h2 className="panel-title">
        {mode === 'p2p' ? <Wifi size={22} style={{ color: 'var(--color-secondary)' }} /> : <Upload size={22} />} 
        {mode === 'p2p' ? ' P2P File Share' : ' Share Content'}
      </h2>

      {/* Mode Toggle Selector */}
      <div className="p2p-toggle-wrapper">
        <button 
          className={`p2p-toggle-btn ${mode === 'standard' ? 'active' : ''}`}
          onClick={() => { setMode('standard'); setActiveTab('files'); handleReset(); }}
          disabled={isUploading || isP2PActive}
        >
          <Upload size={14} /> Regular Upload (100MB)
        </button>
        <button 
          className={`p2p-toggle-btn ${mode === 'p2p' ? 'active' : ''}`}
          onClick={() => { setMode('p2p'); setActiveTab('files'); handleReset(); }}
          disabled={isUploading || isP2PActive}
        >
          Network sharing (Upto 50GB) 
        </button>
      </div>

      {!successData ? (
        <>
          {/* Content Type Tabs (Only show in standard mode) */}
          {mode === 'standard' && (
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
          )}

          {errorMessage && (
            <div className="alert-box error">
              <AlertTriangle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Files Tab View */}
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
                <p className="drop-subtext">
                  {mode === 'p2p' ? 'Supports files up to 50 GB (Network)' : 'Supports files up to 100 MB total'}
                </p>
                <p style={{ color: '#ef4444', textAlign: 'center', fontSize: '12px' }}>
                  Files  use  direct network socket connection to  share the file  so this will break  on  network errors 
                </p>
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

          {/* Text Tab View */}
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

          {/* Action Trigger Button */}
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
                  mode === 'p2p' ? 'Start P2P Share' : 'Share Now'
                )}
              </button>
            </div>
          </div>

          {/* Progress Indicator */}
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
        /* SUCCESS SCREEN OR ACTIVE P2P SCREEN */
        <div className="share-result">
          <div className={`alert-box ${p2pStatus === 'completed' || p2pStatus === 'idle' ? 'success' : (p2pStatus === 'reconnecting' || p2pStatus === 'error' ? 'error' : 'info')}`}>
            {mode === 'p2p' ? (
              <>
                <Wifi size={18} />
                <span>
                  {p2pStatus === 'waiting-for-receiver' && 'P2P Ready: Keep this tab open'}
                  {p2pStatus === 'connecting' && 'Connecting to Receiver...'}
                  {p2pStatus === 'transferring' && 'Transferring Files...'}
                  {p2pStatus === 'reconnecting' && 'Connection lost. Reconnecting (30s)...'}
                  {p2pStatus === 'completed' && 'P2P Share Complete!'}
                </span>
              </>
            ) : (
              <>
                <Check size={18} />
                <span>Uploaded Successfully!</span>
              </>
            )}
          </div>

          {/* PIN Display Panel */}
          <div className="pin-display-container">
            <h3 className="pin-title">Enter this code on target device</h3>
            <div className="pin-code-group">
              <span className="pin-code">{successData.pin}</span>
              <button className="btn-icon-only" onClick={handleCopyPIN} title="Copy PIN">
                {copiedText ? <Check size={18} style={{ color: 'var(--color-success)' }} /> : <Copy size={18} />}
              </button>
            </div>
          </div>

          {/* Connection Statistics for P2P mode */}
          {mode === 'p2p' && p2pStatus !== 'completed' && (
            <div className="p2p-status-box" style={{ width: '100%' }}>
              <div className="p2p-status-item">
                <span>Connection Status:</span>
                <span className="p2p-status-value" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {p2pStatus === 'waiting-for-receiver' && (
                    <>
                      <span className="p2p-pulse"></span> Waiting for peer
                    </>
                  )}
                  {p2pStatus === 'connecting' && 'Negotiating link'}
                  {p2pStatus === 'transferring' && 'Direct P2P Link active'}
                  {p2pStatus === 'reconnecting' && (
                    <span style={{ color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span className="p2p-pulse" style={{ backgroundColor: 'var(--color-accent)', boxShadow: '0 0 8px var(--color-accent)' }}></span> Reconnecting...
                    </span>
                  )}
                </span>
              </div>
              {(p2pStatus === 'transferring' || p2pStatus === 'reconnecting') && (
                <>
                  <div className="p2p-status-item">
                    <span>Sending File:</span>
                    <span className="p2p-status-value" style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p2pCurrentFile}
                    </span>
                  </div>
                  <div className="p2p-status-item">
                    <span>Transfer Speed:</span>
                    <span className="p2p-status-value">{p2pSpeed} MB/s</span>
                  </div>
                  
                  {/* Progress Bar inside Stats */}
                  <div className="progress-container" style={{ width: '100%', marginTop: '0.5rem' }}>
                    <div className="progress-header">
                      <span>Overall Progress</span>
                      <span>{p2pProgress}%</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-bar" style={{ width: `${p2pProgress}%` }}></div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

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

          {errorMessage && (
            <div className="alert-box error" style={{ width: '100%', margin: '0.5rem 0' }}>
              <AlertTriangle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="btn-back-container" style={{ width: '100%' }}>
            <button className="btn-secondary" onClick={handleReset} style={{ width: '100%', justifyContent: 'center' }}>
              {mode === 'p2p' ? 'Stop Sharing / Start New' : 'Share Another Resource'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Uploader;
