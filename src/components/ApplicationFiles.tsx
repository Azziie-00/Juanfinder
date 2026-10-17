import { useRef, useState } from 'react';
import { Button, Modal, Spinner } from 'react-bootstrap';
import { useAuth } from '../context/useAuth';
import { authHeaders } from '../context/authContext.instance';
import { API_BASE_URL, readApiResponse } from '../data/api';
import '../styles/application-files.css';
import PdfPreview from './PdfPreview';
import { applicationFileSummary } from '../data/applicationFileSummary';

export type ApplicationDocument = { DocumentID: number; FileName: string; FileType?: string; FileSize?: number };
type Preview = { document: ApplicationDocument; loading: boolean; url?: string; downloadUrl?: string; text?: string; error?: string };

export default function ApplicationFiles({ applicationId, documents, legacyDocument, detailed = false }: {
  applicationId: number; documents?: ApplicationDocument[]; legacyDocument?: ApplicationDocument | null; detailed?: boolean;
}) {
  const { user, viewRole } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const requestId = useRef(0);
  const files = documents ?? (legacyDocument ? [legacyDocument] : []);
  const confirmed = Array.isArray(documents) || legacyDocument !== undefined;
  const open = async (document: ApplicationDocument) => {
    const current = ++requestId.current;
    setPreview({ document, loading: true });
    try {
      const textPreview = document.FileType !== 'application/pdf' && !document.FileName.toLowerCase().endsWith('.pdf');
      const response = await fetch(`${API_BASE_URL}/adviser/applications/${applicationId}/requirements/${document.DocumentID}${textPreview ? '?preview=text' : ''}`, { headers: authHeaders(user, viewRole) });
      const data = await readApiResponse<{ url: string; downloadUrl: string; text?: string; previewError?: string }>(response, 'Unable to open this application file.');
      if (current === requestId.current) setPreview({ document, loading: false, ...data, error: data.previewError });
    } catch (error) {
      if (current === requestId.current) setPreview({ document, loading: false, error: error instanceof Error ? error.message : 'Unable to open this file.' });
    }
  };
  const close = () => { requestId.current++; setPreview(null); };
  const isPdf = preview?.document.FileType === 'application/pdf' || preview?.document.FileName.toLowerCase().endsWith('.pdf');

  const fileList = <div className="application-file-list">
    {!confirmed ? <span>Application file information is unavailable.</span> : !files.length ? <span>No files were uploaded with this application.</span> : files.map(document => <div className="application-file-row" key={document.DocumentID}>
      <span>{document.FileName}</span>
      <Button size="sm" variant="outline-primary" onClick={() => void open(document)} aria-label={`View ${document.FileName}`}>View</Button>
    </div>)}
  </div>;
  return <>
    {detailed ? fileList : <div className="application-file-summary">
      <span>{applicationFileSummary(confirmed ? files.length : undefined, files[0]?.FileName)}</span>
      {confirmed && files.length > 0 && <Button size="sm" variant="outline-primary" onClick={() => setListOpen(true)}>View files</Button>}
    </div>}
    <Modal show={listOpen} onHide={() => setListOpen(false)} centered className="jf-modal application-file-details">
      <Modal.Header closeButton closeVariant="white"><Modal.Title>Application file details</Modal.Title></Modal.Header>
      <Modal.Body><h3 className="h6">Files uploaded with this application ({files.length})</h3>{fileList}</Modal.Body>
    </Modal>
    <Modal show={Boolean(preview)} onHide={close} centered size="xl" className="jf-modal application-file-modal" backdropClassName="application-file-backdrop">
      <Modal.Header closeButton closeVariant="white"><Modal.Title>{preview?.document.FileName}</Modal.Title></Modal.Header>
      <Modal.Body>
        {preview?.loading && <div role="status"><Spinner size="sm" /> Loading file...</div>}
        {preview?.error && <div className="alert alert-warning" role="alert">{preview.error}</div>}
        {preview && !preview.loading && !preview.error && (isPdf
          ? preview.url && <PdfPreview key={preview.url} url={preview.url} name={preview.document.FileName} />
          : <><p>Word document text preview. Download the original for its full formatting and images.</p><pre className="application-word-preview">{preview.text || 'No readable text was found in this document.'}</pre></>)}
      </Modal.Body>
      <Modal.Footer>
        {preview?.downloadUrl && <a className="btn btn-warning" href={preview.downloadUrl}>Download original</a>}
        <Button variant="secondary" onClick={close}>Close</Button>
      </Modal.Footer>
    </Modal>
  </>;
}
