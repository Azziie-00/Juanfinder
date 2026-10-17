import { useMemo, useState } from 'react';
import { Badge, Button, Form, InputGroup, Modal } from 'react-bootstrap';
import { useAuth } from '../context/useAuth';
import Layout from '../components/Layout';
import '../styles/Library.css';

type Category = 'ALL' | 'THESIS' | 'CAPSTONE';
type SortOption = 'newest' | 'oldest' | 'title';

type LibraryItem = {
  id: string;
  title: string;
  category: Exclude<Category, 'ALL'>;
  icon: string;
  iconBg: string;
  iconColor: string;
  desc: string;
  authors: string;
  year: string;
  pages: string;
  fullText: string;
  department?: string;
  keywords?: string;
  dateAdded?: string;
  pdfUrl?: string;
};

const LIBRARY_ITEMS: LibraryItem[] = [
  {
    id: 'l1', category: 'CAPSTONE',
    title: 'Web-based Capstone Management System',
    icon: 'ti-home', iconBg: '#dbeafe', iconColor: '#2563eb',
    desc: 'A digital capstone coordination platform for task tracking, meeting logs, and adviser assignment workflows.',
    authors: 'Dela Cruz, J., Santos, M., Reyes, C.', year: '2024', pages: '120',
    fullText: 'This capstone project presents a web-based management system designed to streamline capstone project coordination between students, advisers, and administrators at STI. The system features real-time group tracking, document submission, and adviser assignment modules built using React and Node.js.',
    department: 'BSIT', keywords: 'capstone, web app, project management', dateAdded: '2025-05-10', pdfUrl: 'https://example.com/capstone-sample.pdf',
  },
  {
    id: 'l2', category: 'CAPSTONE',
    title: 'Application Development for Student Services',
    icon: 'ti-file-text', iconBg: '#fef3c7', iconColor: '#d97706',
    desc: 'A student services application that centralizes request processing, scheduling, and announcements.',
    authors: 'Mendoza, L., Cruz, A.', year: '2024', pages: '98',
    fullText: 'A mobile-first application developed to improve student service delivery at STI. The app integrates scheduling, announcements, and resource booking into a single platform. Built with Flutter and Firebase for cross-platform support.',
    department: 'BSIT', keywords: 'mobile app, services, scheduling', dateAdded: '2025-04-28', pdfUrl: 'https://example.com/student-services.pdf',
  },
  {
    id: 'l3', category: 'CAPSTONE',
    title: 'AI-Empowered Learning Management System',
    icon: 'ti-bolt', iconBg: '#fee2e2', iconColor: '#dc2626',
    desc: 'An adaptive learning experience powered by AI-driven learner insights and course recommendations.',
    authors: 'Villanueva, R., Aquino, G., Lim, P.', year: '2024', pages: '145',
    fullText: 'This research explores the integration of AI-powered adaptive learning into a campus LMS. The system uses machine learning to personalize learning paths based on student performance data. Evaluation results show a 23% improvement in student engagement metrics.',
    department: 'BSCS', keywords: 'ai, learning, adaptive systems', dateAdded: '2025-04-16', pdfUrl: 'https://example.com/ai-lms.pdf',
  },
  {
    id: 'l4', category: 'CAPSTONE',
    title: 'Game-Dev Platform for K-12 Education',
    icon: 'ti-trophy', iconBg: '#d1fae5', iconColor: '#059669',
    desc: 'A gamified platform for teaching core learning modules through interactive game-based learning.',
    authors: 'Garcia, J., Bautista, F.', year: '2023', pages: '112',
    fullText: 'A gamified educational platform tailored for K-12 students in the Philippines. The platform uses Unity for interactive mini-games aligned to DepEd curriculum standards. Pilot testing in three STI branches showed improved student motivation and quiz scores.',
    department: 'BSIT', keywords: 'education, games, unity', dateAdded: '2025-03-22', pdfUrl: 'https://example.com/game-dev-education.pdf',
  },
  {
    id: 'l5', category: 'CAPSTONE',
    title: 'Web-based Inventory and POS System',
    icon: 'ti-home', iconBg: '#dbeafe', iconColor: '#2563eb',
    desc: 'A commerce and inventory management system built for small retail operations.',
    authors: 'Dela Torre, M., Zuniega, P.', year: '2023', pages: '88',
    fullText: 'A web-based point-of-sale and inventory management system developed for small-to-medium enterprises. The system features real-time stock tracking, sales analytics, and automated restocking alerts. Built using Laravel and Vue.js.',
    department: 'BSIT', keywords: 'inventory, POS, commerce', dateAdded: '2025-02-17', pdfUrl: 'https://example.com/pos-system.pdf',
  },
  {
    id: 'l6', category: 'CAPSTONE',
    title: 'Application for Smart Waste Classification',
    icon: 'ti-file-text', iconBg: '#fef3c7', iconColor: '#d97706',
    desc: 'A mobile application that classifies waste segments using computer vision.',
    authors: 'Santos, M., Reyes, C., Mendoza, L.', year: '2023', pages: '103',
    fullText: 'A mobile application using computer vision to automatically classify waste into recyclable, organic, and residual categories. The model was trained on a custom dataset of over 10,000 waste images. The app achieved 91% classification accuracy in field testing.',
    department: 'BSCS', keywords: 'computer vision, waste, ai', dateAdded: '2025-01-20', pdfUrl: 'https://example.com/waste-classification.pdf',
  },
  {
    id: 'l7', category: 'CAPSTONE',
    title: 'AI-Empowered Air Quality Monitoring Tool',
    icon: 'ti-bolt', iconBg: '#fee2e2', iconColor: '#dc2626',
    desc: 'An IoT air quality predictor combining environmental sensors with AI analytics.',
    authors: 'Cruz, A., Villanueva, R.', year: '2023', pages: '130',
    fullText: 'An IoT-based air quality monitoring system with ML-powered forecasting capabilities. Sensors deployed across the campus collect PM2.5, CO2, and temperature data. The ML model predicts air quality index 24 hours in advance with 87% accuracy.',
    department: 'BSIT', keywords: 'iot, environment, forecasting', dateAdded: '2024-12-23', pdfUrl: 'https://example.com/air-quality.pdf',
  },
  {
    id: 'l8', category: 'CAPSTONE',
    title: 'Game-Dev Tools for Interactive Storytelling',
    icon: 'ti-trophy', iconBg: '#d1fae5', iconColor: '#059669',
    desc: 'A toolkit for building branching story experiences with adaptive dialogue systems.',
    authors: 'Aquino, G., Garcia, J., Torres, R.', year: '2023', pages: '95',
    fullText: 'A toolkit for creating interactive narrative games with branching storylines. The engine supports dynamic character dialogue, inventory systems, and save-state management. Tested with 50 student developers during a 2-week game jam event at STI.',
    department: 'BSIT', keywords: 'game development, storytelling, tools', dateAdded: '2024-11-18', pdfUrl: 'https://example.com/storytelling-tools.pdf',
  },
  {
    id: 'l9', category: 'THESIS',
    title: 'Machine Learning in Student Performance Prediction',
    icon: 'ti-brain', iconBg: '#ede9fe', iconColor: '#7c3aed',
    desc: 'A predictive analytics study using supervised learning to estimate academic outcomes.',
    authors: 'Dela Cruz, J., Santos, M.', year: '2024', pages: '160',
    fullText: 'This thesis investigates the application of machine learning algorithms — specifically Random Forest and Gradient Boosting — to predict student academic performance at the end of each semester. The model was trained on anonymized records of 5,000 STI students and achieved 84% prediction accuracy.',
    department: 'Graduate Studies', keywords: 'machine learning, analytics, education', dateAdded: '2025-02-12', pdfUrl: 'https://example.com/performance-prediction.pdf',
  },
  {
    id: 'l10', category: 'THESIS',
    title: 'Blockchain-Based Academic Record Verification',
    icon: 'ti-shield-lock', iconBg: '#dbeafe', iconColor: '#2563eb',
    desc: 'A decentralized credential verification system for academic documents and institution trust.',
    authors: 'Reyes, C., Mendoza, L.', year: '2024', pages: '142',
    fullText: 'A decentralized verification system for academic records using Ethereum smart contracts. The system allows employers and institutions to verify student credentials without contacting the issuing school. Security audits confirmed resistance to tampering and unauthorized access.',
    department: 'IT Security', keywords: 'blockchain, verification, credentials', dateAdded: '2025-01-14', pdfUrl: 'https://example.com/academic-verification.pdf',
  },
  {
    id: 'l11', category: 'THESIS',
    title: 'Natural Language Processing for Filipino Dialect Recognition',
    icon: 'ti-message', iconBg: '#fef3c7', iconColor: '#d97706',
    desc: 'An NLP model for recognizing regional dialects in Filipino language use cases.',
    authors: 'Cruz, A., Bautista, F., Salazar, A.', year: '2023', pages: '175',
    fullText: 'This thesis presents a fine-tuned NLP model for recognizing and classifying eight major Filipino regional dialects. A custom corpus of 120,000 sentences was compiled from social media and transcribed audio recordings. The model achieves 79% dialect classification accuracy.',
    department: 'Language & AI', keywords: 'nlp, dialects, filipino', dateAdded: '2024-12-15', pdfUrl: 'https://example.com/dialect-recognition.pdf',
  },
  {
    id: 'l12', category: 'THESIS',
    title: 'Cybersecurity Framework for Philippine SMEs',
    icon: 'ti-lock', iconBg: '#fee2e2', iconColor: '#dc2626',
    desc: 'A practical framework for improving readiness and resilience against cyber threats.',
    authors: 'Villanueva, R., Torres, R.', year: '2023', pages: '188',
    fullText: 'A comprehensive cybersecurity framework tailored for small and medium enterprises in the Philippines. The framework addresses common vulnerabilities including phishing, ransomware, and data breaches. A pilot implementation in 12 SMEs reduced security incidents by 64% over six months.',
    department: 'Cybersecurity', keywords: 'cybersecurity, sme, framework', dateAdded: '2024-11-30', pdfUrl: 'https://example.com/cybersecurity-framework.pdf',
  },
];

const ALL_CATEGORIES: Category[] = ['ALL', 'CAPSTONE', 'THESIS'];

export default function Library() {
  const { effectiveRole } = useAuth();
  const isLibraryUser = effectiveRole === 'library';
  const [activeCategory, setActiveCategory] = useState<Category>('ALL');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [selected, setSelected] = useState<LibraryItem | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const base = LIBRARY_ITEMS.filter((item) => {
      const matchesCategory = activeCategory === 'ALL' || item.category === activeCategory;
      const haystack = [item.title, item.authors, item.desc, item.fullText, item.keywords, item.department].join(' ').toLowerCase();
      const matchesSearch = !term || haystack.includes(term);
      return matchesCategory && matchesSearch;
    });

    return [...base].sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      const aDate = new Date(a.dateAdded || '2000-01-01').getTime();
      const bDate = new Date(b.dateAdded || '2000-01-01').getTime();
      return sortBy === 'oldest' ? aDate - bDate : bDate - aDate;
    });
  }, [activeCategory, search, sortBy]);

  return (
    <Layout>
      <div className="library-body">
        <div className="library-toolbar">
          <div className="library-category-tabs">
            {ALL_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`lib-tab-btn${activeCategory === cat ? ' active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat === 'ALL' ? 'All Documents' : cat}
              </button>
            ))}
          </div>
          <div className="library-toolbar-controls">
            {isLibraryUser && (
              <Button className="library-upload-btn">
                <i className="ti ti-plus me-2"></i>Add Files
              </Button>
            )}
            <Form.Select className="lib-sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="title">Title</option>
            </Form.Select>
            <InputGroup className="lib-search-wrap">
              <InputGroup.Text className="lib-search-icon">
                <i className="ti ti-search"></i>
              </InputGroup.Text>
              <Form.Control
                className="lib-search-input"
                placeholder="Search title, author, keywords…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>
          </div>
        </div>

        <div className="library-grid">
          {filtered.length === 0 ? (
            <div className="lib-empty">
              <i className="ti ti-books"></i>
              <p>No results found for "{search || 'this filter'}"</p>
            </div>
          ) : filtered.map((item) => (
            <div key={item.id} className="lib-card">
              <div className="lib-card-icon" style={{ background: item.iconBg }}>
                <i className={`ti ${item.icon}`} style={{ color: item.iconColor }}></i>
              </div>
              <div className="lib-card-title">{item.title}</div>
              <div className="lib-card-meta">
                <span>{item.category}</span>
                <span>{item.year}</span>
              </div>
              <div className="lib-card-desc">{item.desc}</div>
              <div className="lib-card-details">
                <small><strong>Authors:</strong> {item.authors}</small>
                {item.department && <small><strong>Department:</strong> {item.department}</small>}
                {item.keywords && <small><strong>Keywords:</strong> {item.keywords}</small>}
              </div>
              <div className="lib-card-footer">
                <Button className="lib-open-btn" onClick={() => setSelected(item)}>
                  View PDF
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

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
              {selected.department && (
                <>
                  <div className="lib-modal-section-label mt-3">Department</div>
                  <p className="lib-modal-text">{selected.department}</p>
                </>
              )}
              {selected.keywords && (
                <>
                  <div className="lib-modal-section-label mt-3">Keywords</div>
                  <p className="lib-modal-text">{selected.keywords}</p>
                </>
              )}
              {selected.dateAdded && (
                <>
                  <div className="lib-modal-section-label mt-3">Date Added</div>
                  <p className="lib-modal-text">{selected.dateAdded}</p>
                </>
              )}
              <div className="lib-pdf-preview mt-3">
                <div className="lib-pdf-header">
                  <span>PDF Preview</span>
                  <div className="lib-pdf-actions">
                    <Button className="lib-modal-close-btn small">Zoom -</Button>
                    <Button className="lib-modal-close-btn small">Zoom +</Button>
                  </div>
                </div>
                <div className="lib-pdf-surface">
                  <div className="lib-pdf-page">
                    <div className="lib-pdf-page-number">1</div>
                    <h5>{selected.title}</h5>
                    <p>{selected.fullText}</p>
                  </div>
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button className="lib-modal-close-btn" onClick={() => setSelected(null)}>
                Close
              </Button>
              <Button className="lib-modal-dl-btn" onClick={() => selected.pdfUrl && window.open(selected.pdfUrl, '_blank', 'noopener,noreferrer')}>
                <i className="ti ti-download me-2"></i>Download PDF
              </Button>
            </Modal.Footer>
          </>
        )}
      </Modal>
    </Layout>
  );
}
