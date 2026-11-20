// Claude's working steps between two pieces of text, folded into one line:
// what it is doing right now while it works, a count once it is done, and
// the full list on tap. Pictures it took of the app sit underneath.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Loader2, X, Image as ImageIcon } from 'lucide-react';
import { fetchImage } from '../../utils/claudeApi';

function Thumb({ file }) {
  const [src, setSrc] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    // Shared and kept for the session (claudeApi caches it), so not revoked here.
    fetchImage(file).then((u) => live && setSrc(u)).catch(() => {});
    return () => { live = false; };
  }, [file]);
  return (
    <>
      <button className="ccs-thumb" onClick={() => src && setOpen(true)} title="What Claude looked at">
        {src ? <img src={src} alt="What Claude looked at" /> : <ImageIcon size={16} />}
      </button>
      {open && createPortal(
        <div className="ccs-lightbox" onClick={() => setOpen(false)}>
          <img src={src} alt="What Claude looked at" />
        </div>,
        document.body,
      )}
    </>
  );
}

export default function StepGroup({ items }) {
  const [open, setOpen] = useState(false);
  const tools = items.filter((e) => e.t === 'tool');
  const images = items.filter((e) => e.t === 'image');
  const running = tools.find((t) => t.status === 'running');
  const failed = tools.filter((t) => t.status === 'error').length;
  if (!tools.length && !images.length) return null;

  const summary = running
    ? running.label
    : tools.length === 1 ? tools[0].label : `${tools.length} steps`;

  return (
    <div className="ccs">
      {tools.length > 0 && (
        <button className={`ccs-summary ${running ? 'live' : ''}`} onClick={() => setOpen((v) => !v)}>
          {running ? <Loader2 size={14} className="cc-spin" /> : <Check size={14} />}
          <span className="ccs-label">{summary}{running ? '…' : ''}</span>
          {failed > 0 && !running && <span className="ccs-failed">{failed} failed</span>}
          {tools.length > 1 && <ChevronRight size={14} className={`ccs-chevron ${open ? 'open' : ''}`} />}
        </button>
      )}
      {open && tools.length > 1 && (
        <div className="ccs-list">
          {tools.map((t) => (
            <div key={t.seq} className={`ccs-item ${t.status}`}>
              {t.status === 'running' ? <Loader2 size={12} className="cc-spin" /> : t.status === 'error' ? <X size={12} /> : <Check size={12} />}
              <span>{t.label}</span>
            </div>
          ))}
        </div>
      )}
      {images.length > 0 && <div className="ccs-thumbs">{images.map((im) => <Thumb key={im.seq} file={im.file} />)}</div>}
    </div>
  );
}
