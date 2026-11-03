import { BASE_URL, getAuthToken } from '../services/api';

export interface StreamChatOptions {
  query: string;
  provider?: string;
  baseUrl?: string;
  modelName?: string;
  serverIds?: number[];
  startTime?: string;
  endTime?: string;
  datePreset?: string;
  contextWindow?: number;
  density?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  onThought?: (thoughtChunk: string) => void;
  onChunk?: (textChunk: string) => void;
}

/**
 * Executes a streaming chat request to /api/analysis/stream-chat,
 * handling auth tokens, SSE decoding, live reasoning thoughts, status messages, and text chunks.
 */
export async function streamChatQuery(options: StreamChatOptions): Promise<void> {
  const token = getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-Auth-Token'] = token;
  }

  const response = await fetch(`${BASE_URL}/analysis/stream-chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: options.query,
      provider: options.provider || 'lm_studio',
      base_url: options.baseUrl || 'http://localhost:1234/v1',
      model_name: options.modelName || 'local-model',
      server_ids: options.serverIds,
      start_time: options.startTime,
      end_time: options.endTime,
      date_preset: options.datePreset,
      context_window: options.contextWindow || 32768,
      density: options.density || 'concise',
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Network error');
    throw new Error(`Chat request failed (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error('No readable stream returned by server');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let isDone = false;

  while (!isDone) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.replace(/^data:\s*/, '').trim();
        if (dataStr === '[DONE]') {
          if (options.onStatus) options.onStatus('');
          isDone = true;
          try {
            await reader.cancel();
          } catch {}
          break;
        }

        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.status && options.onStatus) {
            options.onStatus(parsed.status);
          }
          if (parsed.thought && options.onThought) {
            options.onThought(parsed.thought);
          }
          if (parsed.chunk && options.onChunk) {
            if (options.onStatus) options.onStatus('');
            options.onChunk(parsed.chunk);
          }
        } catch {
          // Non-JSON or malformed SSE line, ignore
        }
      }
    }
  }
}
