import React, { useEffect } from 'react';
import Uploader from './components/Uploader.jsx';
import Retriever from './components/Retriever.jsx';
import { Zap, Shield, HardDrive, RefreshCw } from 'lucide-react';

function App() {
  useEffect(() => {
    const handleMouseMove = (e) => {
      document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
      document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <div className="app-container">
      {/* Interactive cursor light effect */}
      <div className="interactive-bg" />

      {/* Ko-fi Button - Top Right Corner */}
      <div style={{
        position: 'fixed',
        top: '1.5rem',
        right: '1.5rem',
        zIndex: 1000
      }}>
        <a href='https://ko-fi.com/G8N1219627' target='_blank' rel='noopener noreferrer'>
          <img height='36' style={{ border: '0px', height: '36px' }} src='https://storage.ko-fi.com/cdn/kofi6.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' />
        </a>
      </div>

      {/* Brand Header */}
      <header className="app-header">
        <div className="logo-container" style={{ gap: '1rem', alignItems: 'center' }}>
          {/* Left Eye */}
          <svg className="eye-logo" viewBox="0 0 100 70" width="42" height="30" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="eye-grad-l" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--color-primary)" />
                <stop offset="100%" stopColor="var(--color-secondary)" />
              </linearGradient>
            </defs>
            {/* Eyebrow */}
            <path d="M15,12 C35,0 65,0 85,12" stroke="var(--text-primary)" strokeWidth="5" strokeLinecap="round" />
            {/* Eyelids */}
            <path d="M10,38 C30,16 70,16 90,38 C70,60 30,60 10,38 Z" stroke="url(#eye-grad-l)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            {/* Pupil group */}
            <g className="eye-pupil-group">
              <circle cx="50" cy="38" r="15" fill="url(#eye-grad-l)" />
              <circle cx="50" cy="38" r="6.5" fill="#0f172a" />
              <circle cx="46" cy="34" r="2.5" fill="#ffffff" />
            </g>
          </svg>

          <h1 className="logo-text" style={{ userSelect: 'none' }}>Nokki Nokk</h1>

          {/* Right Eye */}
          <svg className="eye-logo" viewBox="0 0 100 70" width="42" height="30" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="eye-grad-r" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--color-primary)" />
                <stop offset="100%" stopColor="var(--color-secondary)" />
              </linearGradient>
            </defs>
            {/* Eyebrow */}
            <path d="M15,12 C35,0 65,0 85,12" stroke="var(--text-primary)" strokeWidth="5" strokeLinecap="round" />
            {/* Eyelids */}
            <path d="M10,38 C30,16 70,16 90,38 C70,60 30,60 10,38 Z" stroke="url(#eye-grad-r)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            {/* Pupil group */}
            <g className="eye-pupil-group">
              <circle cx="50" cy="38" r="15" fill="url(#eye-grad-r)" />
              <circle cx="50" cy="38" r="6.5" fill="#0f172a" />
              <circle cx="46" cy="34" r="2.5" fill="#ffffff" />
            </g>
          </svg>
        </div>
        <p className="subtitle">
          Secure, temporary file sharing via the internet. Instant 5-digit PIN access. Automatic deletion.
        </p>
      </header>

      {/* Main Workspace */}
      <main className="main-grid">
        {/* Left Side: Uploader */}
        <section>
          <Uploader />
        </section>

        {/* Right Side: Retriever */}
        <section>
          <Retriever />
        </section>
      </main>

      {/* Features Showcase bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1.5rem',
        marginBottom: '3rem'
      }}>
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <HardDrive size={24} style={{ color: 'var(--color-secondary)' }} />
          <div>
            <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>100 MB Regular Upload</h4>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Optimized for quick optimized uploads</p>
          </div>
        </div>
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <HardDrive size={24} style={{ color: 'var(--color-secondary)' }} />
          <div>
            <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>50GB Network File Transfer</h4>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Capped For Heavy File Transfer</p>
          </div>
        </div>
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Shield size={24} style={{ color: 'var(--color-primary)' }} />
          <div>
            <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>Secure Transfer</h4>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Fail-proof expiry & PIN rate limiting</p>
          </div>
        </div>
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <RefreshCw size={24} style={{ color: 'var(--color-success)' }} />
          <div>
            <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>Auto Clean-up</h4>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Files are permanently wiped on expiry</p>
          </div>
        </div>
      </div>

      {/* App Footer */}
      <footer className="app-footer">
        <p>
          nokkinokk File Sharing &copy; {new Date().getFullYear()}. Powered by Node.js, PostgreSQL, and Redis.
        </p>
      </footer>
    </div>
  );
}

export default App;
