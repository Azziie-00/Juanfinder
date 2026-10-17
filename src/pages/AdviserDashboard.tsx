import { Fragment, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { API_BASE_URL, readApiResponse } from '../data/api';
import { authHeaders } from '../context/authContext.instance';
import { createAdviserExport, matchesStudent, type AdviserReport, type ReportKind } from '../data/adviserReport';
import '../styles/admin.css';
import '../styles/workspace.css';

const PAGE_SIZE = 10;
export default function AdviserDashboard() {
  const { user, viewRole } = useAuth();
  const [report, setReport] = useState<AdviserReport | null>(null);
  const [query, setQuery] = useState('');
  const [loadedQuery, setLoadedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [kind, setKind] = useState<ReportKind>('groups');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1);
    window.addEventListener('juan-finder:adviser-applications-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('juan-finder:adviser-applications-changed', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`${API_BASE_URL}/adviser/dashboard?search=${encodeURIComponent(query.trim())}`, { headers: authHeaders(user, viewRole), signal: controller.signal })
        .then(r => readApiResponse<AdviserReport>(r, 'Unable to load your dashboard.'))
        .then(data => { if (!controller.signal.aborted) { setReport(data); setLoadedQuery(query); setPage(1); setExpanded([]); setError(''); } })
        .catch(err => { if (!controller.signal.aborted) { setError(err.message); setReport(null); setLoadedQuery(query); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [user, viewRole, query, revision]);
  const busy = loading || query !== loadedQuery;
  const groups = report?.Groups || [];
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const exportReport = async (format: 'pdf' | 'xlsx') => {
    setExporting(true); setFeedback(''); setError('');
    try {
      // Reauthorize and reload every matching group; no client-supplied adviser/group IDs.
      const fresh = await fetch(`${API_BASE_URL}/adviser/dashboard?search=${encodeURIComponent(query.trim())}`, { headers: authHeaders(user, viewRole) }).then(r => readApiResponse<AdviserReport>(r, 'Unable to load export records.'));
      const blob = await createAdviserExport(fresh, kind, format, query);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `JuanFinder-${kind}-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFeedback(`${format === 'pdf' ? 'PDF' : 'Excel'} report downloaded.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Export failed. Please try again.'); }
    finally { setExporting(false); }
  };
  return <Layout><main className="admin-body adviser-workspace">
    <header className="admin-heading"><div><div className="admin-eyebrow">ADVISER WORKSPACE</div><h1>Dashboard</h1><p>Your assigned groups and student members.</p></div><button className="admin-refresh" aria-label="Refresh dashboard" disabled={exporting} onClick={() => { setLoading(true); setRevision(n => n + 1); }}><span aria-hidden="true">&#8635;</span></button></header>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    {feedback && <div className="alert alert-success" role="status">{feedback}</div>}
    <div className="admin-stats">{[
      ['Groups', report?.Summary.Groups, 'ti-users-group'], ['Student Members', report?.Summary.StudentMembers, 'ti-users'], ['Available Slots', report?.Summary.AvailableSlots, 'ti-layout-grid'],
    ].map(([label, value, icon]) => <div className="admin-stat" key={label}><i className={`ti ${icon}`} /><span>{value ?? '—'}</span><small>{label}</small></div>)}</div>
    <section className="admin-panel" aria-labelledby="student-groups-title">
      <div className="admin-panel-head"><h2 id="student-groups-title">Student Groups</h2><div className="admin-panel-actions">
        <label className="workspace-search">Search Student<input aria-label="Search Student" placeholder="Name or student ID" maxLength={200} value={query} onChange={e => { setQuery(e.target.value); setLoading(true); setFeedback(''); }} /></label>
        <label className="workspace-export-kind">Export contents<select aria-label="Export contents" value={kind} onChange={e => setKind(e.target.value as ReportKind)}><option value="groups">Group summary</option><option value="students">Student member list</option></select></label>
        <button className="admin-add" disabled={busy || exporting || !groups.length} onClick={() => void exportReport('pdf')}>Export PDF</button><button className="admin-add" disabled={busy || exporting || !groups.length} onClick={() => void exportReport('xlsx')}>Export Excel</button>
      </div></div>
      <p className="workspace-hint">{exporting ? 'Preparing report…' : 'Exports include all matching pages. Student lists include only students matching your search.'}</p>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Group Name</th><th>Course</th><th>Member Count</th><th>View</th></tr></thead><tbody>
        {busy ? <tr><td colSpan={4} role="status">Loading groups…</td></tr> : !groups.length ? <tr><td colSpan={4}>No matching student groups.</td></tr> : groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(group => <Fragment key={group.GroupID}>
          <tr><td><strong>{group.GroupName}</strong></td><td>{group.Course}</td><td>{group.MemberCount}</td><td><button className="admin-action" aria-label={`View ${group.GroupName} members`} aria-expanded={expanded.includes(group.GroupID)} aria-controls={`members-${group.GroupID}`} onClick={() => setExpanded(current => current.includes(group.GroupID) ? current.filter(id => id !== group.GroupID) : [...current, group.GroupID])}>{expanded.includes(group.GroupID) ? 'Hide' : 'View'}</button></td></tr>
          {expanded.includes(group.GroupID) && <tr id={`members-${group.GroupID}`}><td colSpan={4}><table className="workspace-members" aria-label={`${group.GroupName} members`}><thead><tr><th>Student ID</th><th>Name</th><th>Course</th></tr></thead><tbody>{group.Members.map(student => <tr key={student.UserID} className={query.trim() && matchesStudent(student, query) ? 'search-match' : ''}><td>{student.UserCode}</td><td>{student.Name}{student.IsLeader && <small>Group leader</small>}</td><td>{student.Course}</td></tr>)}{!group.Members.length && <tr><td colSpan={3}>No student members.</td></tr>}</tbody></table></td></tr>}
        </Fragment>)}
      </tbody></table></div>
      <div className="admin-pagination"><span>{groups.length} groups · Page {page} of {pages}</span><button disabled={busy || page <= 1} onClick={() => setPage(n => n - 1)}>Previous</button><button disabled={busy || page >= pages} onClick={() => setPage(n => n + 1)}>Next</button></div>
    </section>
  </main></Layout>;
}
