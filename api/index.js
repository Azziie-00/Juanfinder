import app from '../server/supabase-server.js';

export default function handler(req, res) {
  const host = req.headers.host || 'localhost';
  const urlObj = new URL(req.url, `http://${host}`);
  const pathParam = urlObj.searchParams.get('__path');

  if (pathParam !== null) {
    urlObj.searchParams.delete('__path');
    const qs = urlObj.searchParams.toString();
    req.url = `/api/${pathParam}${qs ? `?${qs}` : ''}`;
  } else if (req.headers['x-matched-path']) {
    req.url = req.headers['x-matched-path'];
  } else if (!req.url.startsWith('/api')) {
    req.url = `/api${req.url}`;
  }

  return app(req, res);
}
