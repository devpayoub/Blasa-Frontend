import { request } from '@/api/client';
import type { AuthUser, InterestTag, UserPublicProfile } from '@/types';

/** GET /api/v1/users/me/ */
export function me(): Promise<AuthUser> {
  return request('/api/v1/users/me/', { method: 'GET', auth: true });
}

/**
 * GET /api/v1/users/{id}/ — participant trust profile.
 * Public-safe by contract: no phone, email, documents or wallet data.
 */
export function publicProfile(userId: string): Promise<UserPublicProfile> {
  return request(`/api/v1/users/${userId}/`, { method: 'GET', auth: true });
}

export interface ProfilePatch {
  full_name?: string;
  bio?: string;
  interests?: string[];
}

/** PATCH /api/v1/users/me/ — preferred_language and profile fields. */
export function updateMe(patch: Partial<Pick<AuthUser, 'preferred_language'>> & { profile?: ProfilePatch }): Promise<AuthUser> {
  return request('/api/v1/users/me/', { method: 'PATCH', auth: true, body: patch });
}

/**
 * POST /api/v1/users/me/become-driver/ — requires an approved CIN.
 * 400 when the CIN is not verified yet.
 */
export function becomeDriver(): Promise<AuthUser> {
  return request('/api/v1/users/me/become-driver/', { method: 'POST', auth: true });
}

export function requestAvatarUpload(file_name: string, content_type: string, size_bytes: number): Promise<{ upload_url: string; upload_token: string }> {
  return request('/api/v1/users/me/avatar/upload-url/', { method: 'POST', auth: true, body: { file_name, content_type, size_bytes } });
}

export function confirmAvatarUpload(upload_token: string): Promise<AuthUser> {
  return request('/api/v1/users/me/avatar/confirm-upload/', { method: 'POST', auth: true, body: { upload_token } });
}

export function avatarDownloadUrl(): Promise<{ download_url: string }> {
  return request('/api/v1/users/me/avatar/download-url/', { method: 'GET', auth: true });
}

let tagCache: Promise<InterestTag[]> | undefined;

/** GET /api/v1/users/interest-tags/ — fetched once per app session; a failed load is retried on next use. */
export function listInterestTags(): Promise<InterestTag[]> {
  tagCache ??= request<InterestTag[]>('/api/v1/users/interest-tags/', { method: 'GET', auth: true }).catch((err: unknown) => {
    tagCache = undefined;
    throw err;
  });
  return tagCache;
}

/** Display label for a tag slug; falls back to the slug itself while tags load or after one is retired. */
export function tagLabel(slug: string, tags?: InterestTag[]): string {
  return tags?.find((tag) => tag.slug === slug)?.labels.en ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}
