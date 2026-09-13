import Layout from '../components/Layout';

export default function AdviserGroup() {
  return (
    <Layout>
      <div className="d-flex flex-column align-items-center justify-content-center flex-grow-1 gap-3" style={{ background:'var(--bg-page)' }}>
        <i className="ti ti-settings" style={{ fontSize:64, color:'rgba(26,42,74,.3)' }}></i>
        <div style={{ fontSize:22, fontWeight:700, color:'var(--navy)' }}>Group</div>
        <div style={{ fontSize:14, color:'rgba(26,42,74,.5)' }}>Coming soon — manage the capstone groups you advise here.</div>
      </div>
    </Layout>
  );
}
