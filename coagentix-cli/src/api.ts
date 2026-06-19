// HTTP client: wraps tmap-v2 API calls

import type { CoaiConfig } from "./auth.js";

export interface ApiOptions {
  signal?: AbortSignal;
}

export type StreamEvent = {
  kind: string;
  text?: string;
  files?: Array<{ path: string; content: string }>;
  [key: string]: unknown;
};

export class CoaiApiClient {
  constructor(private cfg: CoaiConfig) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.jwt}`,
      "Content-Type": "application/json",
      "User-Agent": `coagentix-cli/1.0.0 Node/${process.version}`,
    };
  }

  private url(path: string): string {
    return `${this.cfg.apiBase}${path}`;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path), { headers: this.headers() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async *stream(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const res = await fetch(this.url(path), {
      method: "POST",
      headers: { ...this.headers(), Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          yield JSON.parse(raw) as StreamEvent;
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  }

  async cliAuth(token: string, device: string): Promise<{ jwt: string; userId: string; email: string; tier: string }> {
    const res = await fetch(this.url("/v1/cli/auth"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, device }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ jwt: string; userId: string; email: string; tier: string }>;
  }

  async getStatus(): Promise<{ ok: boolean; userId: string; username: string; providers: string[] }> {
    return this.get("/v1/cli/status");
  }

  async getHealth(): Promise<Record<string, unknown>> {
    return this.get("/v1/health");
  }
}
