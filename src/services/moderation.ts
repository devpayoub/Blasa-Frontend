import { request } from '@/api/client';
import type { ReportTargetType } from '@/types';

export interface ReportInput {
  target_type: ReportTargetType;
  target_id: string;
  reason: 'HARASSMENT' | 'FRAUD' | 'SAFETY' | 'SPAM' | 'OTHER';
  details?: string;
}

export interface ReportResult {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: string;
  details: string;
  status: 'OPEN' | 'DISMISSED' | 'ACTIONED';
  created_at: string;
}

/**
 * POST /api/v1/moderation/reports/ — the backend validates that the target
 * exists and that the reporter actually took part in it. One open report per
 * target per member; a repeat returns 400.
 */
export function fileReport(input: ReportInput): Promise<ReportResult> {
  return request('/api/v1/moderation/reports/', { method: 'POST', auth: true, body: input });
}
