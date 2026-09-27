import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, Form, Spinner } from 'react-bootstrap';
import { useAuth } from '../context/useAuth';
import type { AuthUser } from '../data/datas';
import '../styles/login.css';

type Role = 'student' | 'adviser' | 'admin' | 'superadmin';

const ROLE_COLORS: Record<Role, string> = {
  student: '#2e6da4',
  adviser: '#2ecc71',
  admin: '#f59e0b',
  superadmin: '#ef4444'
};

const ROLE_ICONS: Record<Role, string> = {
  student: 'ti-user-circle',
  adviser: 'ti-user-star',
  admin: 'ti-shield-lock',
  superadmin: 'ti-shield-star'
};

const ROLE_LABELS: Record<Role, string> = {
  student: 'Student',
  adviser: 'Adviser',
  admin: 'Admin',
  superadmin: 'Super Admin'
};

const PLACEHOLDERS: Record<Role, string> = {
  student: 'e.g. 2023-00001 or juan@sti.edu.ph',
  adviser: 'e.g. orbase@sti.edu.ph',
  admin: 'e.g. admin, ADMIN-001, or Superadmin',
  superadmin: 'e.g. Superadmin or SUPERADMIN-001',
};

const FEATURES = [
  { label: 'Find Group', emoji: '👥', bg: '#e8f4e8' },
  { label: 'View', emoji: '📋', bg: '#f0f4ff' },
  { label: 'Adviser', emoji: '👨‍💼', bg: '#e0f8ff' },
  { label: 'Students', emoji: 'ℹ️', bg: '#f5f5f5' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [show, setShow] = useState(false);
  const [step, setStep] = useState<'role' | 'form'>('role');
  const [role, setRole] = useState<Role>('student');
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const openModal = () => {
    setStep('role');
    setError('');
    setShow(true);
  };

  const closeModal = () => {
    setShow(false);
    setId('');
    setPw('');
    setError('');
  };

  const pickRole = (r: Role) => {
    setRole(r);
    setStep('form');
    setError('');
    setId('');
    setPw('');
  };

  const loginLocally = () => {
    login({ name: id, id, role });
    setLoading(false);
    navigate('/');
  };

  const submit = async () => {
    if (!id || !pw) {
      setError('Please fill in both fields.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: id,
          password: pw,
          role: role,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (import.meta.env.DEV && response.status >= 500) {
          loginLocally();
          return;
        }
        setError(data.message || 'Invalid credentials. Please try again.');
        setLoading(false);
        return;
      }

      const userData: AuthUser = {
        name: data.user.name || data.user.username,
        id: data.user.id || data.user.username,
        role: data.user.role as Role,
        course: data.user.course,
      };

      login(userData);
      setLoading(false);
      navigate('/');
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Login server unavailable; using a local demo session.', error);
        loginLocally();
      } else {
        setError('Cannot connect to the server. Please try again later.');
        setLoading(false);
      }
    }
  };

  return (
    <div className="lp-root">
      {/* Navigation Bar */}
      <nav className="lp-nav navbar">
        <div className="d-flex align-items-center gap-2">
          <span className="lp-sti-badge">STI</span>
          <span className="lp-brand-text">STI JUANFINDER</span>
        </div>

        <Button className="lp-login-btn" onClick={openModal}>
          LOGIN
        </Button>
      </nav>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-text">
          <h1 className="lp-hero-title">
            Find Your Group for Capstone Projects
          </h1>

          <p className="lp-hero-sub">
            JuanFinder helps students view, create, manage and select adviser
          </p>
        </div>

        <div className="lp-hero-illustration">
          <svg viewBox="0 0 420 220" xmlns="http://www.w3.org/2000/svg">
            <rect x="160" y="30" width="200" height="130" rx="10" fill="#c8d8f0" opacity=".9" />
            <rect x="168" y="38" width="184" height="110" rx="6" fill="#e8f0fa" />
            <rect x="178" y="50" width="80" height="8" rx="3" fill="#7a9dc8" opacity=".7" />
            <rect x="178" y="64" width="60" height="6" rx="3" fill="#b0c8e8" opacity=".6" />
            <rect x="270" y="48" width="70" height="44" rx="6" fill="#fff" opacity=".9" />
            <circle cx="285" cy="63" r="8" fill="#7a9dc8" />
            <circle cx="350" cy="42" r="14" fill="#2ecc71" opacity=".9" />
            <polyline
              points="343,42 348,47 357,37"
              fill="none"
              stroke="#fff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="245" y="160" width="30" height="12" rx="3" fill="#a0b8d0" />
            <rect x="220" y="170" width="80" height="8" rx="4" fill="#8aaccc" />
            <circle cx="130" cy="100" r="22" fill="#f5c842" />
            <ellipse cx="130" cy="160" rx="28" ry="20" fill="#1a2a4a" />
            <circle cx="123" cy="97" r="2.5" fill="#1a2a4a" />
            <circle cx="137" cy="97" r="2.5" fill="#1a2a4a" />
            <path
              d="M123 107 Q130 113 137 107"
              fill="none"
              stroke="#1a2a4a"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="75" cy="55" r="16" fill="#f5c842" opacity=".85" />
          </svg>
        </div>
      </section>

      {/* How it Works */}
      <section className="lp-how">
        <h2 className="lp-how-title">How JuanFinder Works</h2>

        <div className="d-flex justify-content-center gap-4 flex-wrap">
          {FEATURES.map((f) => (
            <div
              key={f.label}
              className="lp-feature-card"
              onClick={openModal}
            >
              <div
                className="lp-feature-img"
                style={{ background: f.bg }}
              >
                <span style={{ fontSize: 64 }}>{f.emoji}</span>
              </div>

              <div className="lp-feature-label">{f.label}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="lp-footer">
        JuanFinder System &nbsp;|&nbsp; Contact: &nbsp;JuanFnder@gmail.com
      </footer>

      {/* Login Modal */}
      <Modal
        show={show}
        onHide={closeModal}
        centered
        className="jf-login-modal"
        backdrop="static"
      >
        <Modal.Header
          closeButton
          closeVariant="white"
          className="lp-modal-header"
        >
          <div className="d-flex align-items-center gap-2 mb-1">
            <span className="lp-sti-badge sm">STI</span>
            <span className="lp-brand-text sm">JUANFINDER</span>
          </div>
        </Modal.Header>

        <Modal.Body className="lp-modal-body">
          {step === 'role' ? (
            <>
              <h5 className="lp-modal-title mb-3">Log in</h5>

              <div className="d-flex flex-column gap-2">
                {(['student', 'adviser', 'admin'] as Role[]).map((r) => (
                  <button
                    key={r}
                    className={`lp-role-btn lp-role-${r}`}
                    onClick={() => pickRole(r)}
                  >
                    <i className={`ti ${ROLE_ICONS[r]}`}></i>
                    <span>{ROLE_LABELS[r]}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div
                className="lp-role-pill mb-2"
                style={{
                  background: `${ROLE_COLORS[role]}20`,
                  border: `1.5px solid ${ROLE_COLORS[role]}40`,
                }}
              >
                <i
                  className={`ti ${ROLE_ICONS[role]}`}
                  style={{
                    color: ROLE_COLORS[role],
                    fontSize: 14,
                  }}
                ></i>

                <span
                  style={{
                    color: ROLE_COLORS[role],
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {ROLE_LABELS[role]}
                </span>
              </div>

              <h5 className="lp-modal-title">Welcome Back</h5>

              <p className="lp-modal-sub mb-3">
                Sign in as{' '}
                <strong style={{ color: '#f5c842' }}>
                  {ROLE_LABELS[role]}
                </strong>
              </p>

              <Form>
                <Form.Group className="mb-3">
                  <Form.Label className="jf-label">
                    {role === 'student'
                      ? 'Student ID / Email'
                      : role === 'adviser'
                      ? 'Faculty ID / Email'
                      : 'Admin Username / ID'}
                  </Form.Label>

                  <div className="position-relative">
                    <i
                      className="ti ti-user position-absolute"
                      style={{
                        left: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'rgba(255,255,255,.35)',
                        fontSize: 17,
                        pointerEvents: 'none',
                      }}
                    ></i>

                    <Form.Control
                      className="jf-input ps-5"
                      type="text"
                      placeholder={PLACEHOLDERS[role]}
                      value={id}
                      onChange={(e) => setId(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === 'Enter' && submit()
                      }
                    />
                  </div>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label className="jf-label">
                    Password
                  </Form.Label>

                  <div className="position-relative">
                    <i
                      className="ti ti-lock position-absolute"
                      style={{
                        left: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'rgba(255,255,255,.35)',
                        fontSize: 17,
                        pointerEvents: 'none',
                      }}
                    ></i>

                    <Form.Control
                      className="jf-input ps-5 pe-5"
                      type={showPw ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === 'Enter' && submit()
                      }
                    />

                    <button
                      type="button"
                      className="position-absolute border-0 bg-transparent p-0"
                      style={{
                        right: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'rgba(255,255,255,.4)',
                        fontSize: 17,
                      }}
                      onClick={() => setShowPw((s) => !s)}
                    >
                      <i
                        className={`ti ${
                          showPw ? 'ti-eye-off' : 'ti-eye'
                        }`}
                      ></i>
                    </button>
                  </div>
                </Form.Group>

                {error && (
                  <div
                    className="alert alert-danger d-flex align-items-center gap-2 py-2 px-3 mb-3"
                    style={{
                      fontSize: 12,
                      borderRadius: 8,
                    }}
                  >
                    <i className="ti ti-alert-circle"></i>
                    {error}
                  </div>
                )}

                <Button
                  className="w-100 fw-bold py-2 mb-2"
                  style={{
                    background: ROLE_COLORS[role],
                    border: 'none',
                    borderRadius: 12,
                    fontSize: 15,
                  }}
                  onClick={submit}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Spinner size="sm" className="me-2" />
                      Signing in…
                    </>
                  ) : (
                    'Sign In'
                  )}
                </Button>

                <button
                  type="button"
                  className="w-100 border-0 bg-transparent py-1"
                  style={{
                    color: 'rgba(255,255,255,.4)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                  onClick={() => setStep('role')}
                >
                  <i className="ti ti-arrow-left me-1"></i>
                  Choose a different role
                </button>
              </Form>
            </>
          )}
        </Modal.Body>
      </Modal>
    </div>
  );
}