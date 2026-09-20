import { useState } from 'react';
import { Modal } from 'react-bootstrap';
import Layout from '../components/Layout';
import { ADVISEE_GROUPS } from '../data/datas';
import type { AdviseeGroup } from '../data/datas';
import '../styles/advisee.css';

const PAGE_SIZE = 3;
const ROW_SLOTS = 4;

export default function Advisee() {
  const [groups, setGroups] = useState<AdviseeGroup[]>(ADVISEE_GROUPS.map(g => ({ ...g })));
  const [page, setPage] = useState(1);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [toast, setToast] = useState('');

  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const slice = groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pendingGroups = groups.filter(g => g.pending);

  const acceptGroup = (id: string) => {
    const g = groups.find(gr => gr.id === id);
    setGroups(gs => gs.map(gr => gr.id === id ? { ...gr, pending: false } : gr));
    if (g) {
      setToast(`Accepted "${g.groupName}"`);
      setTimeout(() => setToast(''), 3000);
    }
  };

  const buildSlots = (g: AdviseeGroup) => {
    const filled = g.members;
    const empties = Array(Math.max(0, ROW_SLOTS - filled.length)).fill('');
    return [...filled, ...empties].slice(0, Math.max(ROW_SLOTS, filled.length));
  };

  return (
    <Layout>
      <div className="advisee-body">
        <div className="advisee-toolbar">
          <button className="advisee-back-btn" onClick={() => window.history.back()}>
            <i className="ti ti-arrow-left"></i> BACK
          </button>
          <div className="advisee-toolbar-right">
            <button className="advisee-pending-btn" onClick={() => setPendingOpen(true)}>
              PENDING{pendingGroups.length > 0 ? ` (${pendingGroups.length})` : ''}
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
                const memberSlots = buildSlots(g);
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

      {/* Pending Modal */}
      <Modal show={pendingOpen} onHide={() => setPendingOpen(false)} centered className="advisee-pending-modal">
        <Modal.Body className="p-0">
          <div style={{ position:'relative' }}>
            <div className="advisee-pending-close" onClick={() => setPendingOpen(false)}><i className="ti ti-x"></i></div>
            <div className="advisee-pending-title-wrap">
              <div className="advisee-pending-title">PENDING</div>
            </div>
            <div className="advisee-pending-table-card">
              <table className="advisee-pending-table">
                <thead>
                  <tr>
                    <th>Group Name</th>
                    <th>Member</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingGroups.length === 0 ? (
                    <tr><td colSpan={3} className="advisee-empty">No pending requests.</td></tr>
                  ) : pendingGroups.map(g => {
                    const memberSlots = buildSlots(g);
                    return memberSlots.map((m, i) => (
                      <tr key={`${g.id}-${i}`} className="advisee-pending-member-row">
                        {i === 0 && (
                          <td className="advisee-pending-group-cell" rowSpan={memberSlots.length}>{g.groupName}</td>
                        )}
                        <td>{m}</td>
                        {i === 0 && (
                          <td className="advisee-pending-accept-cell" rowSpan={memberSlots.length}>
                            <button className="advisee-pending-accept-btn" onClick={() => acceptGroup(g.id)}>ACCEPT</button>
                          </td>
                        )}
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Modal.Body>
      </Modal>

      {toast && <div className="jf-toast"><i className="ti ti-circle-check"></i>{toast}</div>}
    </Layout>
  );
}
