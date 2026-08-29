import Layout from '../components/Layout';

export default function Adviser() {
  return (
    <Layout>
      <div className="d-flex flex-column align-items-center justify-content-center flex-grow-1 gap-3" style={{ background:'var(--bg-page)' }}>
        <i className="ti ti-user-circle" style={{ fontSize:64, color:'rgba(26,42,74,.3)' }}></i>
        <div style={{ fontSize:22, fontWeight:700, color:'var(--navy)' }}>Adviser</div>
        <div style={{ fontSize:14, color:'rgba(26,42,74,.5)' }}>Coming soon — select and contact your capstone adviser here.</div>
      </div>
    </Layout>
  );
}