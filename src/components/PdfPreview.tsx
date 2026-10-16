import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Render bytes to canvas rather than navigating to a PDF in an iframe. The latter
// can launch a download when the browser's native PDF viewer is disabled.
export default function PdfPreview({ url, name }: { url: string; name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [pageText, setPageText] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    const load = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('File could not be loaded.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import('pdfjs-dist');
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        task = pdfjs.getDocument({ data: bytes });
        const document = await task.promise;
        if (!cancelled) setPdf(document);
      } catch {
        if (!cancelled) { setError('Unable to preview this PDF. You can download the original to open it.'); setBusy(false); }
      }
    };
    void load();
    return () => { cancelled = true; controller.abort(); void task?.destroy(); };
  }, [url]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !width || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    const render = async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        if (cancelled) return;
        setBusy(true);
        const original = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: width / original.width });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        renderTask = pdfPage.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        await renderTask.promise;
        const text = await pdfPage.getTextContent();
        if (!cancelled) { setPageText(text.items.map(item => 'str' in item ? item.str : '').join(' ')); setBusy(false); }
      } catch {
        if (!cancelled) { setError('Unable to display this PDF page. You can download the original to open it.'); setBusy(false); }
      }
    };
    void render();
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pdf, page, width]);

  const changePage = (next: number) => { setBusy(true); setPage(next); };
  return <div className="application-pdf-preview">
    {pdf && <div className="application-pdf-toolbar">
      <button className="btn btn-sm btn-outline-light" disabled={busy || page === 1} onClick={() => changePage(page - 1)}>Previous page</button>
      <span>Page {page} of {pdf.numPages}</span>
      <button className="btn btn-sm btn-outline-light" disabled={busy || page === pdf.numPages} onClick={() => changePage(page + 1)}>Next page</button>
    </div>}
    {busy && <p role="status">Loading PDF...</p>}
    {error && <div className="alert alert-warning" role="alert">{error}</div>}
    <div ref={containerRef} className="application-pdf-pages" aria-busy={busy}>
      <canvas ref={canvasRef} hidden={!pdf || Boolean(error)} role="img" aria-label={`${name}, page ${page}`} />
      <div className="visually-hidden">{pageText}</div>
    </div>
  </div>;
}
