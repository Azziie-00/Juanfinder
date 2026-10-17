import { useEffect } from 'react';
import { useAuth } from '../context/useAuth';
import { authHeaders } from '../context/authContext.instance';
import { API_BASE_URL } from '../data/api';

// Foreground visits and real interactions count; background notification polls do not.
export default function useWebsiteActivity() {
  const { user, viewRole } = useAuth();
  useEffect(() => {
    if (!user?.sessionToken) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let lastSent = 0;
    let dirty = false;
    let unavailable = false;
    const send = (keepalive = false) => {
      if (!dirty || unavailable) return;
      dirty = false;
      lastSent = Date.now();
      void fetch(`${API_BASE_URL}/activity`, { method: 'POST', headers: authHeaders(user, viewRole), keepalive })
        .then(async response => {
          if (response.status === 202) unavailable = (await response.json()).trackingAvailable === false;
          if (!response.ok) dirty = true;
        }).catch(() => { dirty = true; });
    };
    const activity = () => {
      if (unavailable || document.visibilityState !== 'visible') return;
      dirty = true;
      if (pending) clearTimeout(pending);
      const delay = Math.max(0, 60000 - (Date.now() - lastSent));
      if (!delay) send();
      else pending = setTimeout(() => { if (document.visibilityState === 'visible') send(); }, delay);
    };
    const leaving = () => send(true);
    const visibility = () => { if (document.visibilityState === 'hidden') leaving(); else activity(); };
    activity();
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    window.addEventListener('scroll', activity, true);
    window.addEventListener('pagehide', leaving);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      if (pending) clearTimeout(pending);
      leaving();
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
      window.removeEventListener('scroll', activity, true);
      window.removeEventListener('pagehide', leaving);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [user, viewRole]);
}
