import { request } from '@/api/client';
import type { VerificationDocument } from '@/types';

/** GET /api/v1/verification/documents/ — paginated. */
export function listDocuments(page = 1): Promise<import('@/types').Page<VerificationDocument>> {
  return request(`/api/v1/verification/documents/${page > 1 ? `?page=${page}` : ''}`, { method: 'GET', auth: true });
}

/**
 * POST /api/v1/verification/documents/upload-url/
 * Returns 403 while the legal gate (IDENTITY_DOCUMENT_UPLOADS_ENABLED) is off.
 */
export function requestUploadUrl(doc_type: 'CIN' | 'CARTE_GRISE', file_name: string, content_type: string, size_bytes: number): Promise<{ document_id: string; upload_url: string }> {
  return request('/api/v1/verification/documents/upload-url/', {
    method: 'POST',
    auth: true,
    body: { doc_type, file_name, content_type, size_bytes },
  });
}

/** POST /api/v1/verification/documents/{id}/confirm-upload/ */
export function confirmUpload(id: string): Promise<VerificationDocument> {
  return request(`/api/v1/verification/documents/${id}/confirm-upload/`, {
    method: 'POST',
    auth: true,
  });
}

/** GET /api/v1/verification/documents/{id}/download-url/ */
export function requestDownloadUrl(id: string): Promise<{ download_url: string; expires_in: number }> {
  return request(`/api/v1/verification/documents/${id}/download-url/`, { method: 'GET', auth: true });
}
