import { useState } from 'react';
import { Modal, Button } from 'react-bootstrap';
import Layout from '../components/Layout';
import { ADVISERS } from '../data/datas';
import '../styles/adviser.css';

const PAGE_SIZE = 4;

export default function Adviser() {
  const [page, setPage]           = useState(1);
  const [applied, setApplied]     = useState<Set<string>>(new Set());
  const [modalAdviser, setModalAdviser]   = useState<typeof ADVISERS[number] | null>(null);
  const [detailAdviser, setDetailAdviser] = useState<typeof ADVISERS[number] | null>(null);
  const [toast, setToast]         = useState('');

  const pages = Math.max(1, Math.ceil(ADVISERS.length / PAGE_SIZE));
  const slice = ADVISERS.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const confirmApply = () => {
    if (!modalAdviser) return;
    setApplied(a => new Set(a).add(modalAdviser.id));
    setToast(`Application sent to ${modalAdviser.name}!`);
    setModalAdviser(null);
    setTimeout(() => setToast(''), 3000);
  };

  return (
    <Layout>
      <div className="adviser-body">
        <div className="adviser-toolbar">
          <button className="adv-back-btn" onClick={() => window.history.back()}>
            <i className="ti ti-arrow-left"></i> BACK
          </button>
          <div className="adv-page-arrows">
            <button className="adv-arrow-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
              <i className="ti ti-arrow-left"></i>
            </button>
            <button className="adv-arrow-btn" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages}>
              <i className="ti ti-arrow-right"></i>
            </button>
          </div>
        </div>

        <div className="adviser-table-card">
          <table className="adviser-table">
            <thead>
              <tr>
                <th>Adviser</th>
                <th>Available Slots</th>
                <th>Requirements</th>
              </tr>
            </thead>
            <tbody>
              {slice.length === 0 ? (
                <tr><td colSpan={3} className="adv-empty">No advisers found.</td></tr>
              ) : slice.map(a => {
                const isApplied = applied.has(a.id);
                return (
                  <tr key={a.id}>
                    <td><span className="adv-name-link" onClick={() => setDetailAdviser(a)}>{a.name}</span></td>
                    <td><span className="adv-slots">{a.slots ?? '--'}/{a.maxSlots}</span></td>
                    <td>
                      <button
                        className={`adv-apply-link${isApplied ? ' applied' : ''}`}
                        onClick={() => !isApplied && setModalAdviser(a)}
                        disabled={isApplied}
                      >
                        {isApplied ? 'Applied' : 'Apply'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/*Apply Modal*/}
      <Modal show={!!modalAdviser} onHide={() => setModalAdviser(null)} centered className="jf-modal">
        {modalAdviser && (
          <>
            <Modal.Header closeButton closeVariant="white" className="flex-column align-items-center">
              <div className="modal-icon mb-2"><i className="ti ti-user-circle"></i></div>
              <div className="modal-title-text">Apply to {modalAdviser.name}</div>
              <div className="modal-sub-text">Review the requirements before applying</div>
            </Modal.Header>
            <Modal.Body>
              <div className="d-flex flex-column gap-2">
                {modalAdviser.requirements.map((r, i) => (
                  <div key={i} style={{ fontSize:13, fontWeight:600, color:'var(--amber)', background:'rgba(255,255,255,.05)', borderRadius:30, padding:'10px 16px', textAlign:'center' }}>
                    {r}
                  </div>
                ))}
              </div>
            </Modal.Body>
            <Modal.Footer className="gap-2">
              <Button className="flex-grow-1" style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700, borderRadius:10 }} onClick={confirmApply}>
                Confirm Application
              </Button>
              <Button className="flex-grow-1" style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)', fontWeight:700, borderRadius:10 }} onClick={() => setModalAdviser(null)}>
                Cancel
              </Button>
            </Modal.Footer>
          </>
        )}
      </Modal>

      {/*Detail Modal*/}
      <Modal show={!!detailAdviser} onHide={() => setDetailAdviser(null)} centered size="lg" className="adv-detail-modal">
        {detailAdviser && (
          <Modal.Body className="p-0">
            <div className="adv-detail-inner">
              <div className="adv-detail-left">
                <div className="adv-detail-header with-icon">
                  <div className="adv-detail-header-icon"><i className="ti ti-users-group"></i></div>
                  <div className="adv-detail-header-text">ADVISER</div>
                </div>
                <div className="adv-detail-avatar"><i className="ti ti-user"></i></div>
                <div className="adv-detail-name-pill">ADVISER | {detailAdviser.name.toUpperCase()}</div>
                <div className="adv-detail-bio-box">
                  <div className="adv-detail-bio-label">BIO</div>
                  <div className="adv-detail-bio-text">{detailAdviser.bio || 'No bio provided yet.'}</div>
                </div>
              </div>
              <div className="adv-detail-right">
                <div className="adv-detail-header">
                  <div className="adv-detail-header-text">REQUIREMENTS</div>
                </div>
                <div className="adv-req-list">
                  {detailAdviser.requirements.map((r, i) => (
                    <div key={i} className="adv-req-pill">{r}</div>
                  ))}
                </div>
                <div className="adv-detail-footer">
                  <button className="adv-detail-back-btn" onClick={() => setDetailAdviser(null)}>
                    <i className="ti ti-arrow-left"></i> BACK
                  </button>
                </div>
              </div>
            </div>
          </Modal.Body>
        )}
      </Modal>

      {toast && <div className="jf-toast"><i className="ti ti-circle-check"></i>{toast}</div>}
    </Layout>
  );
}
