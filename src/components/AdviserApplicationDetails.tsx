import { useEffect, useState } from 'react';
import { Modal } from 'react-bootstrap';
import { useAuth } from '../context/useAuth';
import { authHeaders } from '../context/authContext.instance';
import { API_BASE_URL, readApiResponse } from '../data/api';
import ApplicationFiles, { type ApplicationDocument } from './ApplicationFiles';

export type ApplicationReview = {
  ApplicationID: number; GroupName: string; Course: string; MemberCount: number;
  Status: 'Pending' | 'Accepted' | 'Rejected' | 'Expired'; CreatedAt: string; ExpiresAt: string;
  CanAccept: boolean; FileCount: number; FirstFileName: string | null;
  ServerNow?: string;
  Members?: string[]; Requirements?: ApplicationDocument[];
};

export default function AdviserApplicationDetails({ applicationId, onHide, onAccept, onReject, busy, revision }: {
  applicationId: number | null; onHide: () => void; onAccept: (application: ApplicationReview) => void; onReject: (application: ApplicationReview) => void; busy: boolean; revision: number;
}) {
  const { user, viewRole } = useAuth();
  const [result, setResult] = useState<{ id: number; revision: number; application?: ApplicationReview; failed?: boolean; receivedAt?: number } | null>(null);
  const [now, setNow] = useState(() => ({ monotonic: performance.now(), wall: Date.now() }));
  useEffect(() => {
    if (!applicationId) return;
    const interval = window.setInterval(() => setNow({ monotonic: performance.now(), wall: Date.now() }), 1000);
    return () => window.clearInterval(interval);
  }, [applicationId]);
  useEffect(() => {
    if (!applicationId) return;
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/adviser/applications/${applicationId}`, { headers: authHeaders(user, viewRole), signal: controller.signal })
      .then(response => readApiResponse<{ application: ApplicationReview }>(response, 'Application details are unavailable.'))
      .then(data => { if (!controller.signal.aborted) setResult({ id: applicationId, revision, application: data.application, receivedAt: performance.now() }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ id: applicationId, revision, failed: true }); });
    return () => controller.abort();
  }, [applicationId, user, viewRole, revision]);
  const current = result?.id === applicationId && result.revision === revision ? result : null;
  const application = current?.application;
  const serverNow = application?.ServerNow ? Date.parse(application.ServerNow) + Math.max(0, now.monotonic - (current?.receivedAt || now.monotonic)) : now.wall;
  const eligible = application?.CanAccept && application.Status === 'Pending' && Date.parse(application.ExpiresAt) > serverNow;
  return <Modal show={applicationId !== null} onHide={onHide} aria-label="Application details" centered size="lg" scrollable className="jf-modal notification-application-details">
    <Modal.Header closeButton closeVariant="white"><Modal.Title>Application details</Modal.Title></Modal.Header>
    <Modal.Body>
      {!current && <p role="status">Loading application details...</p>}
      {current?.failed && <p role="alert">Application details are unavailable. No file count has been confirmed.</p>}
      {application && <>
        <h2 className="h5">{application.GroupName}</h2>
        <p>{application.Course} · {application.MemberCount} {application.MemberCount === 1 ? 'member' : 'members'} · {application.Status}</p>
        <p>Submitted: <time dateTime={application.CreatedAt}>{new Date(application.CreatedAt).toLocaleString()}</time><br />
          Deadline: <time dateTime={application.ExpiresAt}>{new Date(application.ExpiresAt).toLocaleString()}</time></p>
        {application.Members && <p>Group members: {application.Members.join(', ')}</p>}
        <h3 className="h6">Files uploaded with this application ({application.FileCount})</h3>
        <ApplicationFiles applicationId={application.ApplicationID} documents={application.Requirements} detailed />
      </>}
    </Modal.Body>
    <Modal.Footer>{application?.Status === 'Pending' && <button className="notification-action" disabled={busy || Date.parse(application.ExpiresAt) <= serverNow} onClick={() => onReject(application)}>Reject</button>}<button className="notification-action" disabled={busy || !eligible} onClick={() => application && onAccept(application)}>{busy ? 'Accepting...' : application?.Status === 'Pending' ? 'Accept' : application?.Status || 'Accept'}</button><button className="notification-action" onClick={onHide}>Close</button></Modal.Footer>
  </Modal>;
}
