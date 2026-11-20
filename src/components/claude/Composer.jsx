// The message box: grows with the text, takes attachments (button, paste or
// drop), uploads them as soon as they are added, and sends when they are in.

import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Square, X, FileText, Loader2, AlertTriangle } from 'lucide-react';
import { uploadFile } from '../../utils/claudeApi';

const ACCEPT = 'image/*,application/pdf,.pdf,.csv,text/csv,.xlsx,.xls,.txt,.ofx,.qif';
const isDesktop = () => window.matchMedia('(min-width: 768px) and (pointer: fine)').matches;

export default function Composer({ ref, running, onSend, onStop, placeholder }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const area = useRef(null);
  const picker = useRef(null);

  const addFiles = (list) => {
    for (const file of list) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      setFiles((prev) => [...prev, { key, label: file.name, preview, status: 'uploading' }]);
      uploadFile(file)
        .then((r) => setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, status: 'ready', name: r.name, type: r.type } : f))))
        .catch((e) => setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, status: 'error', error: e.message } : f))));
    }
  };
  useImperativeHandle(ref, () => ({ addFiles, setText: (t) => { setText(t); area.current?.focus(); } }));

  // Grow with the text up to a limit, then scroll inside.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = files.filter((f) => f.status === 'ready');
  const uploading = files.some((f) => f.status === 'uploading');
  const canSend = !running && !uploading && (text.trim() || ready.length);

  const send = async () => {
    if (!canSend) return;
    const ok = await onSend(text.trim(), ready);
    if (ok) {
      files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setText('');
      setFiles([]);
    }
  };

  return (
    <div className="ccc">
      {files.length > 0 && (
        <div className="ccc-files">
          {files.map((f) => (
            <div key={f.key} className={`ccc-file ${f.status}`} title={f.error || f.label}>
              {f.preview ? <img src={f.preview} alt="" /> : <div className="ccc-file-icon"><FileText size={18} /></div>}
              {!f.preview && <span className="ccc-file-name">{f.label}</span>}
              {f.status === 'uploading' && <div className="ccc-file-overlay"><Loader2 size={16} className="cc-spin" /></div>}
              {f.status === 'error' && <div className="ccc-file-overlay err"><AlertTriangle size={16} /></div>}
              <button className="ccc-file-x" onClick={() => setFiles((prev) => prev.filter((x) => x.key !== f.key))} title="Remove">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="ccc-row">
        <button className="ccc-btn" title="Attach a receipt or statement" onClick={() => picker.current?.click()}>
          <Paperclip size={19} />
        </button>
        <input ref={picker} type="file" multiple hidden accept={ACCEPT}
          onChange={(e) => { addFiles([...e.target.files]); e.target.value = ''; }} />
        <textarea
          ref={area}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = [...(e.clipboardData?.files || [])];
            if (pasted.length) { e.preventDefault(); addFiles(pasted); }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && isDesktop()) { e.preventDefault(); send(); }
          }}
        />
        {running ? (
          <button className="ccc-btn ccc-stop" title="Stop" onClick={onStop}><Square size={14} fill="currentColor" /></button>
        ) : (
          <button className="ccc-btn ccc-send" title="Send" disabled={!canSend} onClick={send}><ArrowUp size={19} strokeWidth={2.5} /></button>
        )}
      </div>
    </div>
  );
}
