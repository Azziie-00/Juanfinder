import { useState } from 'react';
import Layout from '../components/Layout';
import { ADVISEE_GROUPS } from '../data/datas';
import '../styles/advisee.css';

const PAGE_SIZE = 3;
const ROW_SLOTS = 4;

export default function Advisee() {
  const [pendingOnly, setPendingOnly] = useState(false);
  const [page, setPage] = useState(1);

  const filtered = pendingOnly ? ADVISEE_GROUPS.filter(g => g.pending) : ADVISEE_GROUPS;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const togglePending = () => {
    setPendingOnly(p => !p);
    setPage(1);
  };

  return (
    <Layout>
      <div className="advisee-body">
        <div className="advisee-toolbar">
          <button className="advisee-back-btn" onClick={() => window.history.back()}>
            <i className="ti ti-arrow-left"></i> BACK
          </button>
          <div className="advisee-toolbar-right">
            <button className={`advisee-pending-btn${pendingOnly ? ' active' : ''}`} onClick={togglePending}>
              PENDING
            </button>
            <button className="advisee-arrow-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
              <i className="ti ti-arrow-left"></i>
            </button>
            <button className="advisee-arrow-btn" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages}>
              <i className="ti ti-arrow-right"></i>
            </button>
          </div>
        </div>

        <div className="advisee-table-card">
          <table className="advisee-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Title</th>
                <th>Member</th>
              </tr>
            </thead>
            <tbody>
              {slice.length === 0 ? (
                <tr><td colSpan={3} className="advisee-empty">No advisee groups found.</td></tr>
              ) : slice.map(g => {
                const memberSlots = [...g.members, ...Array(Math.max(0, ROW_SLOTS - g.members.length)).fill('')].slice(0, Math.max(ROW_SLOTS, g.members.length));
                return memberSlots.map((m, i) => (
                  <tr key={`${g.id}-${i}`} className="advisee-member-row">
                    {i === 0 && (
                      <td className="advisee-group-cell" rowSpan={memberSlots.length}>
                        <span className="advisee-group-link">{g.groupName}</span>
                      </td>
                    )}
                    {i === 0 && (
                      <td className="advisee-title-cell" rowSpan={memberSlots.length}>{g.title}</td>
                    )}
                    <td>{m}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
