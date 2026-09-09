import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertTriangle, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// The failure this exists for is a quiet one: the stored token expires, the app
// carries on looking and behaving exactly as before, and every change made from
// then on stays on the device. Nothing else in the UI changes, so the warning
// has to be unavoidable and it has to say what is at stake — how much work is
// sitting here unsent — rather than just reporting a status.
export default function SessionAlert() {
  const { sessionExpired, countPendingChanges } = useAuth();
  const [pending, setPending] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!sessionExpired) {
      setPending(null);
      return undefined;
    }
    let alive = true;
    const read = () => countPendingChanges()
      .then(count => { if (alive) setPending(count); })
      .catch(() => {});
    read();
    // Re-counted while the banner is up, so the number keeps pace with anything
    // added after the session lapsed.
    const timer = setInterval(read, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionExpired, countPendingChanges]);

  if (!sessionExpired) return null;

  return (
    <div className="session-alert" role="alert">
      <AlertTriangle size={18} className="session-alert-icon" />
      <div className="session-alert-text">
        <strong>Not syncing — this device is signed out</strong>
        <span>
          {pending > 0
            ? `${pending} change${pending === 1 ? '' : 's'} ${pending === 1 ? 'is' : 'are'} saved here only. `
            : 'Anything you add now stays on this device only. '}
          Sign in again to back {pending > 0 ? 'them' : 'it'} up.
        </span>
      </div>
      <button
        type="button"
        className="session-alert-cta"
        onClick={() => navigate('/login', { state: { reason: 'session-expired', from: location } })}
      >
        <LogIn size={16} />
        Sign in
      </button>
    </div>
  );
}
