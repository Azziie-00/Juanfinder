import { useState } from 'react';
import { Modal, Button, Badge, Form, InputGroup } from 'react-bootstrap';
import Layout from '../components/Layout';
import '../styles/Library.css';

type Category = 'THESIS' | 'CAPSTONE';

interface LibraryItem {
  id: string;
  title: string;
  category: Category;
  icon: string;
  iconBg: string;
  iconColor: string;
  desc: string;
  authors: string;
  year: string;
  pages: string;
  fullText: string;
}

const LIBRARY_ITEMS: LibraryItem[] = [
  {
    id: 'l1', category: 'CAPSTONE',
    title: 'Web-based Capstone Management System',
    icon: 'ti-home', iconBg: '#dbeafe', iconColor: '#2563eb',
    desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    authors: 'Dela Cruz, J., Santos, M., Reyes, C.', year: '2024', pages: '120',
    fullText: 'This capstone project presents a web-based management system designed to streamline capstone project coordination between students, advisers, and administrators at STI. The system features real-time group tracking, document submission, and adviser assignment modules built using React and Node.js.',
  },
  {
    id: 'l2', category: 'CAPSTONE',
    title: 'Application Development for Student Services',
    icon: 'ti-file-text', iconBg: '#fef3c7', iconColor: '#d97706',
    desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    authors: 'Mendoza, L., Cruz, A.', year: '2024', pages: '98',
    fullText: 'A mobile-first application developed to improve student service delivery at STI. The app integrates scheduling, announcements, and resource booking into a single platform. Built with Flutter and Firebase for cross-platform support.',
  },
  {
    id: 'l3', category: 'CAPSTONE',
    title: 'AI-Empowered Learning Management System',
    icon: 'ti-bolt', iconBg: '#fee2e2', iconColor: '#dc2626',
    desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    authors: 'Villanueva, R., Aquino, G., Lim, P.', year: '2024', pages: '145',
    fullText: 'This research explores the integration of AI-powered adaptive learning into a campus LMS. The system uses machine learning to personalize learning paths based on student performance data. Evaluation results show a 23% improvement in student engagement metrics.',
  },
  {
    id: 'l4', category: 'CAPSTONE',
    title: 'Game-Dev Platform for K-12 Education',
    icon: 'ti-trophy', iconBg: '#d1fae5', iconColor: '#059669',
    desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    authors: 'Garcia, J., Bautista, F.', year: '2023', pages: '112',
    fullText: 'A gamified educational platform tailored for K-12 students in the Philippines. The platform uses Unity for interactive mini-games aligned to DepEd curriculum standards. Pilot testing in three STI branches showed improved student motivation and quiz scores.',
  },
  {
    id: 'l5', category: 'CAPSTONE',
    title: 'Web-based Inventory and POS System',
    icon: 'ti-home', iconBg: '#dbeafe', iconColor: '#2563eb',
    desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    authors: 'Dela Torre, M., Zuniega, P.', year: '2023', pages: '88',
    fullText: 'A web-based point-of-sale and inventory management system developed for small-to-medium enterprises. The system features real-time stock tracking, sales analytics, and automated restocking alerts. Built using Laravel and Vue.js.',
  },
  {
    id: 'l6', category: 'CAPSTONE',
    title: 'Application for Smart Waste Classification',
    icon: 'ti-file-text', iconBg: '#fef3c7', iconColor: '#d97706',
    desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    authors: 'Santos, M., Reyes, C., Mendoza, L.', year: '2023', pages: '103',
    fullText: 'A mobile application using computer vision to automatically classify waste into recyclable, organic, and residual categories. The model was trained on a custom dataset of over 10,000 waste images. The app achieved 91% classification accuracy in field testing.',
  },
  {
    id: 'l7', category: 'CAPSTONE',
    title: 'AI-Empowered Air Quality Monitoring Tool',
    icon: 'ti-bolt', iconBg: '#fee2e2', iconColor: '#dc2626',
    desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    authors: 'Cruz, A., Villanueva, R.', year: '2023', pages: '130',
    fullText: 'An IoT-based air quality monitoring system with ML-powered forecasting capabilities. Sensors deployed across the campus collect PM2.5, CO2, and temperature data. The ML model predicts air quality index 24 hours in advance with 87% accuracy.',
  },
  {
    id: 'l8', category: 'CAPSTONE',
    title: 'Game-Dev Tools for Interactive Storytelling',
    icon: 'ti-trophy', iconBg: '#d1fae5', iconColor: '#059669',
    desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    authors: 'Aquino, G., Garcia, J., Torres, R.', year: '2023', pages: '95',
    fullText: 'A toolkit for creating interactive narrative games with branching storylines. The engine supports dynamic character dialogue, inventory systems, and save-state management. Tested with 50 student developers during a 2-week game jam event at STI.',
  },
  {
    id: 'l9', category: 'THESIS',
    title: 'Machine Learning in Student Performance Prediction',
    icon: 'ti-brain', iconBg: '#ede9fe', iconColor: '#7c3aed',
    desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    authors: 'Dela Cruz, J., Santos, M.', year: '2024', pages: '160',
    fullText: 'This thesis investigates the application of machine learning algorithms — specifically Random Forest and Gradient Boosting — to predict student academic performance at the end of each semester. The model was trained on anonymized records of 5,000 STI students and achieved 84% prediction accuracy.',
  },
  {
    id: 'l10', category: 'THESIS',
    title: 'Blockchain-Based Academic Record Verification',
    icon: 'ti-shield-lock', iconBg: '#dbeafe', iconColor: '#2563eb',
    desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    authors: 'Reyes, C., Mendoza, L.', year: '2024', pages: '142',
    fullText: 'A decentralized verification system for academic records using Ethereum smart contracts. The system allows employers and institutions to verify student credentials without contacting the issuing school. Security audits confirmed resistance to tampering and unauthorized access.',
  },
  {
    id: 'l11', category: 'THESIS',
    title: 'Natural Language Processing for Filipino Dialect Recognition',
    icon: 'ti-message', iconBg: '#fef3c7', iconColor: '#d97706',
    desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    authors: 'Cruz, A., Bautista, F., Salazar, A.', year: '2023', pages: '175',
    fullText: 'This thesis presents a fine-tuned NLP model for recognizing and classifying eight major Filipino regional dialects. A custom corpus of 120,000 sentences was compiled from social media and transcribed audio recordings. The model achieves 79% dialect classification accuracy.',
  },
  {
    id: 'l12', category: 'THESIS',
    title: 'Cybersecurity Framework for Philippine SMEs',
    icon: 'ti-lock', iconBg: '#fee2e2', iconColor: '#dc2626',
    desc: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    authors: 'Villanueva, R., Torres, R.', year: '2023', pages: '188',
    fullText: 'A comprehensive cybersecurity framework tailored for small and medium enterprises in the Philippines. The framework addresses common vulnerabilities including phishing, ransomware, and data breaches. A pilot implementation in 12 SMEs reduced security incidents by 64% over six months.',
  },
];

export default function Library() {
  const [activeCategory, setActiveCategory] = useState<Category>('CAPSTONE');
  const [search, setSearch]                 = useState('');
  const [selected, setSelected]             = useState<LibraryItem | null>(null);

  const filtered = LIBRARY_ITEMS.filter(item =>
    item.category === activeCategory &&
    item.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="library-body">

        {/* Filter tabs + search */}
        <div className="library-toolbar d-flex align-items-center gap-3 flex-wrap">
          <div className="d-flex gap-2">
            {(['CAPSTONE', 'THESIS'] as Category[]).map(cat => (
              <button
                key={cat}
                className={`lib-tab-btn${activeCategory === cat ? ' active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="flex-grow-1"></div>
          <InputGroup className="lib-search-wrap">
            <InputGroup.Text className="lib-search-icon">
              <i className="ti ti-search"></i>
            </InputGroup.Text>
            <Form.Control
              className="lib-search-input"
              placeholder="Search titles…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </InputGroup>
        </div>

        {/* Grid */}
        <div className="library-grid">
          {filtered.length === 0 ? (
            <div className="lib-empty">
              <i className="ti ti-books"></i>
              <p>No results found for "{search}"</p>
            </div>
          ) : filtered.map(item => (
            <div key={item.id} className="lib-card">
              <div className="lib-card-icon" style={{ background: item.iconBg }}>
                <i className={`ti ${item.icon}`} style={{ color: item.iconColor }}></i>
              </div>
              <div className="lib-card-title">{item.title}</div>
              <div className="lib-card-desc">{item.desc}</div>
              <div className="lib-card-footer">
                <Button className="lib-open-btn" onClick={() => setSelected(item)}>
                  OPEN
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail Modal */}
      <Modal show={!!selected} onHide={() => setSelected(null)} centered size="lg" className="lib-modal">
        {selected && (
          <>
            <Modal.Header closeButton closeVariant="white">
              <div className="d-flex align-items-center gap-3">
                <div className="lib-modal-icon" style={{ background: selected.iconBg }}>
                  <i className={`ti ${selected.icon}`} style={{ color: selected.iconColor }}></i>
                </div>
                <div>
                  <Modal.Title className="lib-modal-title">{selected.title}</Modal.Title>
                  <div className="lib-modal-sub">{selected.authors}</div>
                </div>
              </div>
            </Modal.Header>
            <Modal.Body>
              <div className="d-flex gap-2 mb-3 flex-wrap">
                <Badge className="lib-badge-cat">{selected.category}</Badge>
                <Badge className="lib-badge-year"><i className="ti ti-calendar me-1"></i>{selected.year}</Badge>
                <Badge className="lib-badge-pages"><i className="ti ti-file me-1"></i>{selected.pages} pages</Badge>
              </div>
              <div className="lib-modal-section-label">Abstract</div>
              <p className="lib-modal-text">{selected.fullText}</p>
              <div className="lib-modal-section-label mt-3">Authors</div>
              <p className="lib-modal-text">{selected.authors}</p>
            </Modal.Body>
            <Modal.Footer>
              <Button className="lib-modal-close-btn" onClick={() => setSelected(null)}>
                Close
              </Button>
              <Button className="lib-modal-dl-btn">
                <i className="ti ti-download me-2"></i>Download PDF
              </Button>
            </Modal.Footer>
          </>
        )}
      </Modal>
    </Layout>
  );
}