import { useEffect, useRef, useState } from 'react';

export type AdviserApplicationStatus = {
  ApplicationID: number; GroupID?: number; GroupName?: string; AdviserName: string;
  Status: 'Pending' | 'Accepted' | 'Rejected' | 'Expired'; CreatedAt?: string;
  ExpiresAt?: string; RespondedAt?: string | null; ServerNow?: string;
};
export default function ApplicationDeadline({ application, onDeadline }: { application: AdviserApplicationStatus; onDeadline: () => void }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const notified = useRef(false);
  useEffect(() => {
    if (!application.ExpiresAt || application.Status !== 'Pending') return;
    const initial = new Date(application.ExpiresAt).getTime() - new Date(application.ServerNow || new Date().toISOString()).getTime();
    const anchor = performance.now();
    let active = true;
    notified.current = false;
    const tick = () => {
      if (!active) return;
      const milliseconds = Math.max(0, initial - (performance.now() - anchor));
      setRemaining(Math.ceil(milliseconds / 1000));
      if (!milliseconds && !notified.current) { notified.current = true; onDeadline(); }
    };
    // A microtask avoids a synchronous state update during effect setup.
    queueMicrotask(tick);
    const interval = window.setInterval(tick, 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, [application.ApplicationID, application.ExpiresAt, application.ServerNow, application.Status, onDeadline]);
  if (!application.ExpiresAt) return null;
  const deadline = new Date(application.ExpiresAt).toLocaleString();
  const hours = Math.floor((remaining || 0) / 3600);
  const minutes = Math.floor(((remaining || 0) % 3600) / 60);
  const seconds = (remaining || 0) % 60;
  return <div className="application-deadline">
    {application.Status === 'Pending' && <>
      <span>Deadline: <time dateTime={application.ExpiresAt}>{deadline}</time></span>
      <span aria-label="Application time remaining">{remaining === null ? 'Checking deadline...' : remaining > 0 ? `${hours}h ${minutes}m ${seconds}s remaining` : 'Deadline reached. Checking application status...'}</span>
    </>}
    {application.Status === 'Expired' && <span>Expired at <time dateTime={application.ExpiresAt}>{deadline}</time>. Your group can apply again.</span>}
    {(application.Status === 'Accepted' || application.Status === 'Rejected') && application.RespondedAt && <span>{application.Status} on <time dateTime={application.RespondedAt}>{new Date(application.RespondedAt).toLocaleString()}</time></span>}
  </div>;
}
