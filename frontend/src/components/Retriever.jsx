import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { 
  Download, FileText, Link2, Shield, AlertTriangle, Clock, 
  Copy, Check, File, Image, Film, FileAudio, ExternalLink, Zap, Wifi
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

  // P2P states
  const [p2pStatus, setP2PStatus] = useState('idle'); // 'idle' | 'connecting' | 'transferring' | 'completed' | 'error'
  const [p2pProgress, setP2PProgress] = useState(0);
  const [p2pSpeed, setP2PSpeed] = useState('0.00');
  const [p2pCurrentFile, setP2pCurrentFile] = useState('');
  
  const inputRefs = [useRef(), useRef(), useRef(), useRef(), useRef()];

  // P2P refs
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const fileSaveHandleRef = useRef(null);
  const directoryHandleRef = useRef(null);
  const p2pWritableStreamRef = useRef(null);
  const p2pChunksBufferRef = useRef([]);
  const p2pReceivedBytesRef = useRef(0);
  const p2pCurrentFileSizeRef = useRef(0);
  const lastTimeRef = useRef(Date.now());
  const lastBytesRef = useRef(0);
  const receiverClientIdRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const isReconnectingRef = useRef(false);
  const iceCandidatesQueue = useRef([]);
  const p2pStatusRef = useRef(p2pStatus);

  useEffect(() => {
    p2pStatusRef.current = p2pStatus;
  }, [p2pStatus]);

  useEffect(() => {
    if (!receiverClientIdRef.current) {
      receiverClientIdRef.current = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
  }, []);

  const supportsFileSystemAccess = 'showSaveFilePicker' in window;

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
        clearInterval(timer);
        // Do NOT close connection/clear status if actively transferring P2P files
        if (shareData.type !== 'p2p' || p2pStatusRef.current === 'idle' || p2pStatusRef.current === 'error') {
          handleClear();
          setError('The shared resources have expired.');
        }
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
    if (p2pWritableStreamRef.current) {
      try {
        p2pWritableStreamRef.current.close();
      } catch (e) {}
      p2pWritableStreamRef.current = null;
    }
    // We do NOT clear fileSaveHandleRef, directoryHandleRef or p2pChunksBufferRef
    // during a peer disconnect cleanup to preserve resumption state.
  };

  // Handle digit inputs
  const handleDigitChange = (index, value) => {
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

    if (index < 4) {
      inputRefs[index + 1].current.focus();
    }
  };

  const handleKeyDown = (index, e) => {
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
      inputRefs[4].current.blur();
      triggerRetrieve(pastedData);
    }
  };

  const triggerRetrieve = async (pinCode) => {
    setError('');
    setIsLoading(true);
    setShareData(null);
    setP2PStatus('idle');

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
    cleanupPeerConnection();
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setPinDigits(['', '', '', '', '']);
    setShareData(null);
    setError('');
    setP2PStatus('idle');
    setP2PProgress(0);
    setP2PSpeed('0.00');
    setP2pCurrentFile('');
    const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.pushState({ path: newurl }, '', newurl);
  };

  const handleCopyText = () => {
    if (!shareData || !shareData.data.content) return;
    navigator.clipboard.writeText(shareData.data.content);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  // P2P Download trigger logic
  const handleP2PDownloadClick = async () => {
    setError('');
    
    const totalSize = shareData.data.files.reduce((sum, f) => sum + f.size, 0);

    // Prompt user to select directory/file saving path BEFORE handshake (user gesture restriction)
    if (supportsFileSystemAccess && totalSize > 50 * 1024 * 1024) {
      try {
        if (shareData.data.files.length === 1) {
          const fileMeta = shareData.data.files[0];
          const handle = await window.showSaveFilePicker({
            suggestedName: fileMeta.name
          });
          fileSaveHandleRef.current = handle;
        } else {
          if ('showDirectoryPicker' in window) {
            const handle = await window.showDirectoryPicker();
            directoryHandleRef.current = handle;
          } else {
            console.warn('showDirectoryPicker not supported. Falling back to RAM buffering.');
          }
        }
      } catch (err) {
        console.warn('User cancelled save picker. Falling back to RAM download.', err);
      }
    }

    setP2PStatus('connecting');
    setP2PProgress(0);
    setP2PSpeed('0.00');
    setP2pCurrentFile('');

    // Connect to Signaling WebSockets
    const socket = io({
      transports: ['websocket']
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      const pinCode = pinDigits.join('');
      socket.emit('join-p2p-receiver', { pin: pinCode, receiverClientId: receiverClientIdRef.current });
    });

    socket.on('p2p-joined', ({ isReconnect }) => {
      console.log('Joined P2P session on server. isReconnect:', isReconnect);
      if (isReconnect) {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      }
    });

    socket.on('p2p-signal', async ({ senderSocketId, signal }) => {
      if (signal.type === 'offer') {
        await acceptWebRTCOffer(senderSocketId, signal);
      }
    });

    socket.on('p2p-ice-candidate', async ({ candidate }) => {
      const pc = peerConnectionRef.current;
      if (pc) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error('Error adding ICE candidate:', e);
          }
        } else {
          console.log('Queueing ICE candidate (remote description not set yet)');
          iceCandidatesQueue.current.push(candidate);
        }
      }
    });

    socket.on('p2p-session-closed', ({ message }) => {
      setError(message || 'Sender disconnected.');
      setP2PStatus('error');
      cleanupPeerConnection();
    });

    socket.on('p2p-error', ({ message }) => {
      setError(message);
      setP2PStatus('error');
      cleanupPeerConnection();
    });
  };

  // Accept WebRTC offer and reply with answer
  const acceptWebRTCOffer = async (senderSocketId, offer) => {
    // Clear old WebRTC structures, keeping stream and reconnect configs
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
          targetSocketId: senderSocketId,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Receiver connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        isReconnectingRef.current = false;
        setP2PStatus('transferring');
        lastTimeRef.current = Date.now();
        lastBytesRef.current = 0;
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        if (p2pStatus === 'transferring') {
          isReconnectingRef.current = true;
          setP2PStatus('reconnecting');
          
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            setError('Direct connection lost. Reconnection timed out.');
            setP2PStatus('error');
            cleanupPeerConnection();
          }, 30000);
        } else {
          setError('Direct P2P connection failed or lost.');
          setP2PStatus('error');
          cleanupPeerConnection();
        }
      }
    };

    pc.ondatachannel = (e) => {
      const dc = e.channel;
      dataChannelRef.current = dc;
      dc.binaryType = 'arraybuffer';
      dc.onmessage = handleDataChannelMessage;
      
      dc.onopen = async () => {
        console.log('Receiver data channel open');
        if (isReconnectingRef.current) {
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          isReconnectingRef.current = false;
          setP2PStatus('transferring');
          
          console.log(`Re-established data channel. Resuming file ${p2pCurrentFile} from offset ${p2pReceivedBytesRef.current}`);
          
          // Seek file stream if active
          if (supportsFileSystemAccess && (fileSaveHandleRef.current || directoryHandleRef.current)) {
            try {
              if (p2pWritableStreamRef.current) {
                try { await p2pWritableStreamRef.current.close(); } catch (err) {}
              }
              
              let fileHandle;
              if (directoryHandleRef.current) {
                fileHandle = await directoryHandleRef.current.getFileHandle(p2pCurrentFile, { create: true });
              } else {
                fileHandle = fileSaveHandleRef.current;
              }
              const writable = await fileHandle.createWritable({ keepExistingData: true });
              await writable.seek(p2pReceivedBytesRef.current);
              p2pWritableStreamRef.current = writable;
            } catch (err) {
              console.error('Failed to seek stream, falling back to RAM buffer', err);
              p2pWritableStreamRef.current = null;
            }
          }
          
          // Request sender to resume from our offset
          dc.send(JSON.stringify({
            type: 'resume-request',
            fileName: p2pCurrentFile,
            offset: p2pReceivedBytesRef.current
          }));
        }
      };
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      // Process queued candidates
      const queued = iceCandidatesQueue.current;
      iceCandidatesQueue.current = [];
      for (const cand of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.error('Error adding queued ICE candidate:', e);
        }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current.emit('p2p-signal', {
        targetSocketId: senderSocketId,
        signal: answer
      });
    } catch (err) {
      console.error('Failed to create answer:', err);
      setError('WebRTC negotiation failed.');
      setP2PStatus('error');
    }
  };

  // Handle incoming chunks and assemble files
  const handleDataChannelMessage = async (event) => {
    if (typeof event.data === 'string') {
      const msg = JSON.parse(event.data);
      
      if (msg.type === 'start') {
        setP2pCurrentFile(msg.name);
        p2pCurrentFileSizeRef.current = msg.size;
        p2pReceivedBytesRef.current = 0;
        p2pChunksBufferRef.current = [];

        // Check if stream writing to disk is available
        const hasHandle = fileSaveHandleRef.current || directoryHandleRef.current;
        if (supportsFileSystemAccess && hasHandle) {
          try {
            let fileHandle;
            if (directoryHandleRef.current) {
              fileHandle = await directoryHandleRef.current.getFileHandle(msg.name, { create: true });
            } else {
              fileHandle = fileSaveHandleRef.current;
            }
            p2pWritableStreamRef.current = await fileHandle.createWritable();
          } catch (err) {
            console.error('Failed to get writable stream, falling back to RAM buffer', err);
            p2pWritableStreamRef.current = null;
          }
        } else {
          p2pWritableStreamRef.current = null;
        }
      } else if (msg.type === 'end') {
        if (p2pWritableStreamRef.current) {
          try {
            await p2pWritableStreamRef.current.close();
          } catch (e) {}
          p2pWritableStreamRef.current = null;
        } else {
          // Fallback RAM buffer: Convert array of chunks to a Blob and download
          const blob = new Blob(p2pChunksBufferRef.current, { type: msg.mime || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = msg.name;
          a.click();
          URL.revokeObjectURL(url);
        }
        p2pChunksBufferRef.current = [];
      } else if (msg.type === 'all-completed') {
        setP2PStatus('completed');
        cleanupPeerConnection();
        if (socketRef.current) {
          socketRef.current.disconnect();
          socketRef.current = null;
        }
      }
    } else {
      // Binary chunk arrayBuffer
      const chunk = event.data;
      p2pReceivedBytesRef.current += chunk.byteLength;

      if (p2pWritableStreamRef.current) {
        try {
          await p2pWritableStreamRef.current.write(chunk);
        } catch (err) {
          console.error('Error writing chunk to file system:', err);
        }
      } else {
        p2pChunksBufferRef.current.push(chunk);
      }

      updateReceiverProgress(p2pReceivedBytesRef.current);
    }
  };

  const updateReceiverProgress = (fileBytesReceived) => {
    const totalBytes = shareData.data.files.reduce((sum, f) => sum + f.size, 0);
    const currentFileIndex = shareData.data.files.findIndex(f => f.name === p2pCurrentFile);
    
    const bytesFromCompletedFiles = shareData.data.files
      .slice(0, currentFileIndex)
      .reduce((sum, f) => sum + f.size, 0);

    const totalReceived = bytesFromCompletedFiles + fileBytesReceived;
    const percent = Math.min(100, Math.round((totalReceived / totalBytes) * 100));
    setP2PProgress(percent);

    const now = Date.now();
    const duration = (now - lastTimeRef.current) / 1000;
    if (duration >= 0.5) {
      const bytesDiff = totalReceived - lastBytesRef.current;
      const speedMBPerSec = (bytesDiff / duration) / (1024 * 1024);
      setP2PSpeed(speedMBPerSec.toFixed(2));
      
      lastTimeRef.current = now;
      lastBytesRef.current = totalReceived;
    }
  };

  const getFileIcon = (mimeType) => {
    if (!mimeType) return <File size={24} style={{ color: 'var(--text-secondary)' }} />;
    if (mimeType.startsWith('image/')) return <Image size={24} style={{ color: 'var(--color-secondary)' }} />;
    if (mimeType.startsWith('video/')) return <Film size={24} style={{ color: 'var(--color-accent)' }} />;
    if (mimeType.startsWith('audio/')) return <FileAudio size={24} style={{ color: 'var(--color-success)' }} />;
    return <File size={24} style={{ color: 'var(--text-secondary)' }} />;
  };

  const totalP2PSize = shareData?.type === 'p2p' ? shareData.data.files.reduce((sum, f) => sum + f.size, 0) : 0;

  return (
    <div className="glass-panel retrieve-card">
      <h2 className="panel-title">
        {shareData?.type === 'p2p' ? <Wifi size={22} style={{ color: 'var(--color-secondary)' }} /> : <Shield size={22} />} 
        {shareData?.type === 'p2p' ? ' Direct P2P Access' : ' Access Content'}
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
                maxLength={2}
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
              {shareData.type === 'p2p' && <Zap size={16} style={{ color: 'var(--color-secondary)' }} />}
              <span>{shareData.type === 'p2p' ? 'P2P Files' : shareData.type} Shared</span>
            </div>

            <div className="countdown-box" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
              <Clock size={12} />
              <span>Expiry: <strong>{timeLeft || 'Checking...'}</strong></span>
            </div>
          </div>

          {error && (
            <div className="alert-box error" style={{ width: '100%', marginBottom: '1.5rem' }}>
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          )}

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

          {/* Regular Files List display */}
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

          {/* P2P Files & Connection UI Display */}
          {shareData.type === 'p2p' && (
            <div>
              {/* File Listing */}
              <div className="download-grid" style={{ marginBottom: '1.5rem' }}>
                {shareData.data.files && shareData.data.files.map((file, idx) => (
                  <div className="download-item" key={idx} style={{ opacity: p2pStatus === 'completed' ? 1 : 0.85 }}>
                    <div className="file-info">
                      {getFileIcon(file.type)}
                      <div className="file-details">
                        <span className="file-name" title={file.name}>{file.name}</span>
                        <span className="file-size">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                      </div>
                    </div>
                    {p2pStatus === 'completed' && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-success)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                        <Check size={14} /> Saved
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* P2P Controls & Stats */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', marginBottom: '1.5rem' }}>
                {p2pStatus === 'idle' && (
                  <>
                    {!supportsFileSystemAccess && totalP2PSize > 1.5 * 1024 * 1024 * 1024 && (
                      <div className="alert-box error" style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                        <AlertTriangle size={18} />
                        <span>Warning: Your browser does not support direct disk streaming. Downloading {((totalP2PSize) / (1024 * 1024 * 1024)).toFixed(2)} GB to RAM may crash this tab. We recommend using Chrome or Edge.</span>
                      </div>
                    )}
                    <button className="btn-primary" onClick={handleP2PDownloadClick}>
                      <Wifi size={18} /> Connect & Download (P2P)
                    </button>
                  </>
                )}

                {p2pStatus === 'connecting' && (
                  <div className="p2p-status-box">
                    <div className="p2p-status-item">
                      <span>Connection:</span>
                      <span className="p2p-status-value" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span className="p2p-pulse"></span> Connecting to sender
                      </span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      Establishing secure peer-to-peer tunnel. Please keep the sender's tab active.
                    </p>
                  </div>
                )}

                {p2pStatus === 'transferring' && (
                  <div className="p2p-status-box">
                    <div className="p2p-status-item">
                      <span>Receiving:</span>
                      <span className="p2p-status-value" style={{ maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p2pCurrentFile}
                      </span>
                    </div>
                    <div className="p2p-status-item">
                      <span>Speed:</span>
                      <span className="p2p-status-value">{p2pSpeed} MB/s</span>
                    </div>
                    
                    {/* Progress bar */}
                    <div className="progress-container" style={{ width: '100%', marginTop: '0.5rem' }}>
                      <div className="progress-header">
                        <span>P2P Stream Progress</span>
                        <span>{p2pProgress}%</span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-bar" style={{ width: `${p2pProgress}%` }}></div>
                      </div>
                    </div>
                  </div>
                )}

                {p2pStatus === 'reconnecting' && (
                  <div className="p2p-status-box" style={{ background: 'rgba(225, 29, 72, 0.04)', border: '1px solid rgba(225, 29, 72, 0.1)' }}>
                    <div className="p2p-status-item">
                      <span>Connection:</span>
                      <span className="p2p-status-value" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--color-accent)' }}>
                        <span className="p2p-pulse" style={{ backgroundColor: 'var(--color-accent)', boxShadow: '0 0 8px var(--color-accent)' }}></span> Reconnecting (30s)...
                      </span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      P2P direct link failed. Retrying signaling connection...
                    </p>
                  </div>
                )}

                {p2pStatus === 'completed' && (
                  <div className="alert-box success" style={{ margin: 0, justifyContent: 'center' }}>
                    <Check size={18} />
                    <span>All files downloaded and saved!</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="btn-back-container" style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '1.5rem' }}>
            <button className="btn-secondary" onClick={handleClear} style={{ width: '100%', justifyContent: 'center' }}>
              {shareData.type === 'p2p' ? 'Close & Retrieve Another' : 'Access Another PIN'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Retriever;
