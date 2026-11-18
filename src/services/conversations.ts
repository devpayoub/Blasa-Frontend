import { request } from '@/api/client';
import type { Conversation, Message, Page } from '@/types';

function asPage<T>(data: Page<T> | T[]): Page<T> {
  if (Array.isArray(data)) return { count: data.length, next: null, previous: null, results: data };
  if (!data || !Array.isArray(data.results)) throw new Error('Could not read the chat response. Try again.');
  return data;
}

/** Only confirmed bookings and paid, terminal booking histories are readable. */
export async function listConversations(page = 1): Promise<Page<Conversation>> {
  return asPage(await request<Page<Conversation> | Conversation[]>(
    `/api/v1/conversations/${page > 1 ? `?page=${page}` : ''}`, { method: 'GET', auth: true },
  ));
}

export async function getConversation(id: string): Promise<Conversation> {
  const conversation = await request<Conversation>(`/api/v1/conversations/${encodeURIComponent(id)}/`, { method: 'GET', auth: true });
  if (!conversation || conversation.id !== id || typeof conversation.can_send !== 'boolean' || typeof conversation.booking_status !== 'string') {
    throw new Error('Could not verify chat access. Try again.');
  }
  return conversation;
}

/** The messages API returns a flat array; tolerate the existing paginated mock/envelope too. */
export async function listMessages(conversationId: string): Promise<Page<Message>> {
  return asPage(await request<Page<Message> | Message[]>(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/`, { method: 'GET', auth: true },
  ));
}

/** Sending always uses REST, including while the live connection is unavailable. */
export function sendMessage(conversationId: string, body: string): Promise<Message> {
  return request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/`, {
    method: 'POST',
    auth: true,
    body: { body },
  });
}
