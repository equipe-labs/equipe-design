// Client for the design library API v1 (docs/library-api.md). One `fetch`, one retry, every
// response checked against the zod types in @equipe-design/api-contract.
import { readFileSync } from 'node:fs';
import {
  DEFAULT_BASE_URL, ErrorBody, Meta, PUBLIC_FORMATS, ReleaseList, RemixRequest, RemixResponse, StyleDetail, StyleList,
  TokenFiles, type ORIGINS,
} from '@equipe-design/api-contract';
import type { z } from 'zod';

export { DEFAULT_BASE_URL, PUBLIC_FORMATS };
export type {
  Meta, RemixRequest, RemixResponse, StyleCard, StyleDetail, StyleList, TokenFiles, ReleaseDetail,
} from '@equipe-design/api-contract';

export type PublicFormat = (typeof PUBLIC_FORMATS)[number];

export const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
export const USER_AGENT = `equipe-design/${VERSION}`;

/** A failed call. `status` is 0 when the server could not be reached. */
export class LibraryError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface StyleQuery {
  q?: string;
  category?: string;
  tag?: string;
  origin?: (typeof ORIGINS)[number];
  hasDark?: boolean;
  /** 0–359; matches brand colours within ±20°. */
  hue?: number;
  sort?: 'updated' | 'name';
}

export interface ClientOptions {
  /** Default: $EQUIPE_DESIGN_API, else https://equipe.im/api/design/v1. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Wait before the one retry, ms. Default 500. */
  retryDelayMs?: number;
  env?: NodeJS.ProcessEnv;
}

export function baseUrlFrom(env: NodeJS.ProcessEnv = process.env): string {
  return (env.EQUIPE_DESIGN_API?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export class LibraryClient {
  readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly retryDelayMs: number;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? baseUrlFrom(opts.env)).replace(/\/+$/, '');
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.retryDelayMs = opts.retryDelayMs ?? 500;
  }

  listStyles(query: StyleQuery = {}): Promise<StyleList> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
    const qs = params.toString();
    return this.get(`/styles${qs ? `?${qs}` : ''}`, StyleList);
  }

  getStyle(slug: string): Promise<StyleDetail> {
    return this.get(`/styles/${enc(slug)}`, StyleDetail);
  }

  getReleases(slug: string): Promise<z.infer<typeof ReleaseList>> {
    return this.get(`/styles/${enc(slug)}/releases`, ReleaseList);
  }

  /** A release's files in one format. Give `{ style }` for the current release (the server answers 302). */
  getTokens(ref: { releaseId: string } | { style: string }, format: PublicFormat): Promise<TokenFiles> {
    const path = 'releaseId' in ref
      ? `/releases/${enc(ref.releaseId)}/tokens/${enc(format)}`
      : `/styles/${enc(ref.style)}/tokens/${enc(format)}`;
    return this.get(path, TokenFiles);
  }

  /** The server's remix (what equipe.im's preview uses). The CLI and MCP remix locally instead: see ./local.ts. */
  remix(req: RemixRequest): Promise<RemixResponse> {
    return this.call('/remix', RemixResponse, { method: 'POST', body: JSON.stringify(req), headers: { 'content-type': 'application/json' } });
  }

  meta(): Promise<Meta> {
    return this.get('/meta', Meta);
  }

  private get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.call(path, schema, { method: 'GET' });
  }

  private async call<T>(path: string, schema: z.ZodType<T>, init: RequestInit): Promise<T> {
    const url = this.baseUrl + path;
    const headers = { accept: 'application/json', 'user-agent': USER_AGENT, ...(init.headers as Record<string, string> | undefined) };
    let res: Response | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await sleep(this.retryDelayMs);
      try {
        res = await this.fetch(url, { ...init, headers, redirect: 'follow' });
      } catch (e) {
        lastError = e;
        res = null;
        continue;
      }
      if (res.status !== 429 && res.status < 500) break;
    }
    if (!res) {
      throw new LibraryError(`could not reach the design library at ${this.baseUrl} (${(lastError as Error)?.message ?? 'no answer'})`, 0, 'unreachable');
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const err = ErrorBody.safeParse(json);
      const code = err.success ? err.data.error.code : 'http_error';
      const msg = err.success ? err.data.error.message : `HTTP ${res.status}`;
      throw new LibraryError(`${init.method} ${path}: ${res.status} ${msg}`, res.status, code);
    }
    if (json === undefined) throw new LibraryError(`${init.method} ${path}: the answer is not JSON`, res.status, 'bad_response');
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new LibraryError(`${init.method} ${path}: the answer does not match API v1 (${first?.path.join('.')}: ${first?.message})`, res.status, 'bad_response');
    }
    return parsed.data;
  }
}

const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createClient(opts: ClientOptions = {}): LibraryClient {
  return new LibraryClient(opts);
}
