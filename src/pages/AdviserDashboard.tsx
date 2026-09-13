import { useState } from 'react';
import { Row, Col, Form } from 'react-bootstrap';
import { Modal, Button } from 'react-bootstrap';
import Layout from '../components/Layout';
import Calendar from '../components/Calendar';
import { ADVISER_STATS, ADVISER_ANNOUNCEMENT } from '../data/datas';
import type { AdviserAnnouncement } from '../data/datas';
import '../styles/adviser-dashboard.css';

export default function AdviserDashboard() {
  const [announcement, setAnnouncement] = useState<AdviserAnnouncement>(() => {
    const saved = sessionStorage.getItem('jf_adviser_announcement');
    return saved ? JSON.parse(saved) : ADVISER_ANNOUNCEMENT;
  });
  const [editOpen, setEditOpen] = useState(false);
  const [detailInput, setDetailInput] = useState('');

  const openEdit = () => {
    setDetailInput(announcement.detail);
    setEditOpen(true);
  };

  const saveAnnouncement = () => {
    const updated: AdviserAnnouncement = { ...announcement, detail: detailInput || ADVISER_ANNOUNCEMENT.detail };
    setAnnouncement(updated);
    sessionStorage.setItem('jf_adviser_announcement', JSON.stringify(updated));
    setEditOpen(false);
  };

  return (
    <Layout>
      <div className="dashboard-content">
        <Row className="g-3" style={{ flexShrink:0 }}>
          <Col xs={12} md={4}>
            <div className="stat-card h-100">
              <div className="stat-label"><i className="ti ti-users"></i> Advisee</div>
              <div className="stat-num">{ADVISER_STATS.advisee}</div>
            </div>
          </Col>
          <Col xs={12} md={4}>
            <div className="stat-card h-100">
              <div className="stat-label"><i className="ti ti-settings"></i> Group</div>
              <div className="stat-num">{ADVISER_STATS.group}</div>
            </div>
          </Col>
          <Col xs={12} md={4}>
            <div className="stat-card h-100">
              <div className="stat-label"><i className="ti ti-user"></i> Student List</div>
              <div className="stat-num">{ADVISER_STATS.studentList}</div>
            </div>
          </Col>
        </Row>

        <Row className="g-3 mt-0" style={{ flex:1, minHeight:0 }}>
          <Col xs={12} lg={8}>
            <div className="adv-announce-card">
              <div className="adv-announce-header">
                <div className="adv-announce-header-left">
                  <div className="adv-announce-icon"><i className="ti ti-speakerphone"></i></div>
                  <div className="adv-announce-title">Announcement</div>
                </div>
                <button className="adv-announce-add" onClick={openEdit}><i className="ti ti-plus"></i></button>
              </div>
              <div className="adv-announce-body">
                <div className="adv-announce-body-text">{announcement.detail}</div>
              </div>
            </div>
          </Col>
          <Col xs={12} lg={4}>
            <Calendar />
          </Col>
        </Row>
      </div>

      {/*Edit Announcement Modal*/}
      <Modal show={editOpen} onHide={() => setEditOpen(false)} centered className="jf-modal">
        <Modal.Header closeButton closeVariant="white" className="flex-column align-items-center">
          <div className="modal-icon mb-2"><i className="ti ti-speakerphone"></i></div>
          <div className="modal-title-text">Post Announcement</div>
          <div className="modal-sub-text">Share an update with your advisees</div>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group>
              <Form.Label className="jf-label">Announcement Detail</Form.Label>
              <Form.Control as="textarea" className="jf-input" rows={4} value={detailInput} onChange={e => setDetailInput(e.target.value)} placeholder="Write your announcement..." />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer className="gap-2">
          <Button className="flex-grow-1" style={{ background:'var(--amber)', border:'none', color:'var(--navy)', fontWeight:700, borderRadius:10 }} onClick={saveAnnouncement}>Post</Button>
          <Button className="flex-grow-1" style={{ background:'rgba(255,255,255,.08)', border:'none', color:'rgba(255,255,255,.55)', fontWeight:700, borderRadius:10 }} onClick={() => setEditOpen(false)}>Cancel</Button>
        </Modal.Footer>
      </Modal>
    </Layout>
  );
}
