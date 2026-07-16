import { describe, expect, it, vi } from 'vitest';
import { ChatApiError, fetchChatEvents } from './api.js';
import { CHAT_FIXTURE_EVENTS } from './fixtures.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('fetchChatEvents', () => {
  it('GETs the project chat stream and sends the bearer token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: CHAT_FIXTURE_EVENTS }));
    const events = await fetchChatEvents('default', {
      fetchImpl,
      getToken: () => 'tok-123',
      baseUrl: 'http://127.0.0.1:4317',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects/default/chat',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }),
      }),
    );
    expect(events).toEqual(CHAT_FIXTURE_EVENTS);
  });

  it('URL-encodes the project id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    await fetchChatEvents('has space', { fetchImpl, getToken: () => 'tok' });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/projects/has%20space/chat',
      expect.anything(),
    );
  });

  it('omits the Authorization header when there is no token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    await fetchChatEvents('default', { fetchImpl, getToken: () => undefined });
    const headers = fetchImpl.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('surfaces a non-ok response as ChatApiError with the problem detail', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: 'no project' }, 404));
    await expect(
      fetchChatEvents('default', { fetchImpl, getToken: () => 'tok' }),
    ).rejects.toMatchObject({ status: 404, message: 'no project' });
  });
});

describe('ChatApiError', () => {
  it('falls back to a generic message when the body has no detail', () => {
    const err = new ChatApiError(500);
    expect(err.message).toContain('500');
  });
});
