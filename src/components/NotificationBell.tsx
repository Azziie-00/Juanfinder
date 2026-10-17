import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { authHeaders } from '../context/authContext.instance';
import { API_BASE_URL, ApiResponseError, readApiResponse } from '../data/api';
import { applicationFileSummary } from '../data/applicationFileSummary';
import AdviserApplicationDetails, { type ApplicationReview } from './AdviserApplicationDetails';
import '../styles/notifications.css';

type Notification = {
  notification_id: number; notification_type: string; title: string; message: string;
  application_id: number | null; group_id: number | null; created_at: string; read_at: string | null;
  application?: (ApplicationReview & { ServerNow?: string }) | null;
  outcome?: { GroupName: string; AdviserName: string; Status: string; RespondedAt: string | null } | null;
  receivedAt?: number;
};
type Inbox = { items: Notification[]; unreadCount: number; hasMore: boolean; nextCursor: number | null };
const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export default function NotificationBell() {
  const { user, viewRole, effectiveRole } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => ({ monotonic: performance.now(), wall: Date.now() }));
  const actionInFlight = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const panelId = useId();
  const diagnostics = (operation: string, error: unknown) => {
    // Never log response bodies, names, filenames, IDs, headers or tokens.
    console.warn('Notification request failed', { operation, status: error instanceof ApiResponseError ? error.status : 'network' });
  };

  const load = useCallback(async (before?: number) => {
    if (!user || actionInFlight.current) return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/notifications${before ? `?before=${before}` : ''}`, { headers: authHeaders(user, viewRole), signal: request.signal });
      const next = await readApiResponse<Inbox>(response, 'Notification request failed.');
      if (!next || !Array.isArray(next.items) || !Number.isSafeInteger(next.unreadCount) || next.unreadCount < 0) throw new Error('Invalid notification response');
      if (request.signal.aborted) return;
      const receivedAt = performance.now();
      next.items = next.items.map(item => ({ ...item, receivedAt }));
      setInbox(current => before && current ? { ...next, items: [...new Map([...current.items, ...next.items].map(item => [item.notification_id, item])).values()] } : next);
      setLoadFailed(false);
    } catch (requestError) {
      if (!request.signal.aborted) { setLoadFailed(true); diagnostics('load', requestError); }
    } finally { if (!request.signal.aborted) setLoading(false); }
  }, [user, viewRole]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = () => { void load(); };
    const interval = window.setInterval(refresh, open ? 5000 : 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('juan-finder:notifications-changed', refresh);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); window.removeEventListener('focus', refresh); window.removeEventListener('juan-finder:notifications-changed', refresh); controller.current?.abort(); };
  }, [load, open]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => { if (open) panel.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const interval = window.setInterval(() => setNow({ monotonic: performance.now(), wall: Date.now() }), 1000);
    return () => window.clearInterval(interval);
  }, [open]);

  const markRead = async (notification?: Notification) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    controller.current?.abort();
    setLoading(false);
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/notifications/${notification ? `${notification.notification_id}/read` : 'read-all'}`, { method: 'PATCH', headers: authHeaders(user, viewRole) });
      const result = await readApiResponse<{ readAt: string; unreadCount: number }>(response, 'Unable to mark notifications as read.');
      setInbox(current => current && { ...current, unreadCount: result.unreadCount, items: current.items.map(item => !notification || item.notification_id === notification.notification_id ? { ...item, read_at: item.read_at || result.readAt } : item) });
      return true;
    } catch (requestError) { diagnostics('mark-read', requestError); return false; }
    finally { actionInFlight.current = false; setBusy(false); }
  };
  const openNotification = async (notification: Notification) => {
    if (actionInFlight.current) return;
    if (!notification.read_at) await markRead(notification);
    setOpen(false);
    if (notification.notification_type === 'adviser_application_submitted' && notification.application_id && effectiveRole === 'adviser') {
      setSelectedApplication(notification.application_id); return;
    }
    navigate(notification.application_id ? `/adviser?application=${notification.application_id}` : notification.group_id ? '/mygroup' : '/adviser');
  };
  const canAccept = (application: Notification['application'], receivedAt?: number) => {
    if (!application || effectiveRole !== 'adviser' || !application.CanAccept || application.Status !== 'Pending') return false;
    const remaining = Date.parse(application.ExpiresAt) - (application.ServerNow ? Date.parse(application.ServerNow) + Math.max(0, now.monotonic - (receivedAt || now.monotonic)) : now.wall);
    return remaining > 0;
  };
  const respond = async (application: ApplicationReview, action: 'accept' | 'reject') => {
    if (actionInFlight.current || application.Status !== 'Pending' || (action === 'accept' && !application.CanAccept) || effectiveRole !== 'adviser') return;
    actionInFlight.current = true; setBusy(true); setActionError('');
    controller.current?.abort();
    try {
      const response = await fetch(`${API_BASE_URL}/adviser/applications/${application.ApplicationID}/respond`, {
        method: 'POST', headers: authHeaders(user, viewRole, { 'Content-Type': 'application/json' }), body: JSON.stringify({ action }),
      });
      await readApiResponse(response, 'Unable to process this application.');
    } catch (error) {
      diagnostics(action, error);
      setActionError(error instanceof ApiResponseError ? error.message : 'Application could not be processed. Open its details to check the current status.');
    } finally {
      setRevision(current => current + 1);
      window.dispatchEvent(new Event('juan-finder:adviser-applications-changed'));
      actionInFlight.current = false;
      await load();
      setBusy(false);
    }
  };

  return <><div className="notification-container" ref={container}>
    <button type="button" className="notification-toggle" ref={button} aria-label={inbox?.unreadCount ? `Notifications, ${inbox.unreadCount} unread` : 'Notifications'} aria-expanded={open} aria-controls={panelId} onClick={() => { setOpen(current => !current); if (!open) void load(); }}>
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" /><path d="M10 21h4" /></svg>
      {Boolean(inbox?.unreadCount) && <span className="notification-badge" aria-hidden="true">{inbox!.unreadCount}</span>}
    </button>
    {open && <section id={panelId} className="notification-panel" role="dialog" aria-label="Notifications" tabIndex={-1} ref={panel}>
      <header className="notification-header"><h2>Notifications</h2><button type="button" disabled={busy || !inbox?.unreadCount} onClick={() => void markRead()}>Mark all as read</button></header>
      {actionError && <p className="notification-action-error" role="alert">{actionError}</p>}
      {loading && !inbox && <p className="notification-empty" role="status">Loading notifications...</p>}
      {!loading && !loadFailed && inbox?.items.length === 0 && <p className="notification-empty">You have no notifications yet.</p>}
      {!loading && loadFailed && !inbox && <p className="notification-empty" role="status">Notifications will appear here when available.</p>}
      <div className="notification-list">
        {inbox?.items.map(item => <article key={item.notification_id} className={`notification-item${item.read_at ? ' is-read' : ' is-unread'}`}>
          <button type="button" disabled={busy} className="notification-open" onClick={() => void openNotification(item)}>
          <span className={`notification-status ${item.read_at ? 'is-read' : 'is-unread'}`} role="img" aria-label={item.read_at ? 'Read notification' : 'Unread notification'} title={item.read_at ? 'Read' : 'Unread'}>{item.read_at ? '✓' : '×'}</span>
          <span className="notification-content"><strong>{item.title}</strong><span>{item.message}</span><time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>{formatTime(item.created_at)}</time></span>
          </button>
          {item.outcome && <div className="notification-application">
            <strong>{item.outcome.GroupName}</strong>
            <p>Adviser: {item.outcome.AdviserName}</p><p>Status: {item.outcome.Status}</p>
            {item.outcome.RespondedAt && <p>{item.outcome.Status} at <time dateTime={item.outcome.RespondedAt}>{formatTime(item.outcome.RespondedAt)}</time></p>}
            <button type="button" className="notification-action" disabled={busy} onClick={() => void openNotification(item)}>View</button>
          </div>}
          {item.notification_type === 'adviser_application_submitted' && <div className="notification-application">
            {item.application ? <>
              <strong>{item.application.GroupName}</strong>
              <p>{item.application.Course} · {item.application.MemberCount} {item.application.MemberCount === 1 ? 'member' : 'members'}</p>
              <p>Submitted: <time dateTime={item.application.CreatedAt}>{formatTime(item.application.CreatedAt)}</time></p>
              <p>24-hour deadline: <time dateTime={item.application.ExpiresAt}>{formatTime(item.application.ExpiresAt)}</time></p>
              <p>Application files ({item.application.FileCount}): {applicationFileSummary(item.application.FileCount, item.application.FirstFileName)}</p>
              <p>Status: {item.application.Status}</p>
            </> : <p>Application details are unavailable.</p>}
            <div className="notification-actions"><button type="button" className="notification-action" disabled={busy || !item.application_id} onClick={() => void openNotification(item)}>View</button>
              <button type="button" className="notification-action" disabled={busy || !canAccept(item.application, item.receivedAt)} onClick={() => item.application && void respond(item.application, 'accept')}>{busy ? 'Saving...' : 'Accept'}</button></div>
          </div>}
        </article>)}
      </div>
      {inbox?.hasMore && <button className="notification-more" type="button" disabled={loading} onClick={() => void load(inbox.nextCursor || undefined)}>{loading ? 'Loading...' : 'Load more notifications'}</button>}
    </section>}
  </div><AdviserApplicationDetails applicationId={selectedApplication} onHide={() => setSelectedApplication(null)} onAccept={application => void respond(application, 'accept')} onReject={application => void respond(application, 'reject')} busy={busy} revision={revision} />
  {selectedApplication && actionError && <div className="jf-toast" role="alert">{actionError}</div>}</>;
}
