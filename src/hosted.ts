import { canonicalize } from './jcs.js';
import { HASH_RE, hashOf } from './hash.js';
import { parseStrict } from './strict.js';
import { verify } from './verify.js';
import { KeyRing } from './keys.js';
import { Receipt, Detail } from './receipt.js';
import { Process, validateProcess, FREQUENCY_RE } from './process.js';

/** Direct Supabase client. No LogLine HTTP server, cookies or session required.
 * The caller owns OAuth acquisition/refresh and the trusted machine key ring. */
export interface HostedOptions {
  url: string;
  publishableKey: string;
  keys: KeyRing;
  accessToken?: () => string | null | Promise<string | null>;
  fetcher?: typeof fetch;
}
export class HostedRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export interface HostedSubmission { receipt: Receipt; detail: Detail; replayed: boolean }
export function hostedClient(options: HostedOptions) {
  const base = new URL(options.url);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('expected a Supabase origin');
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('HTTPS required');
  if (!options.publishableKey || options.publishableKey.startsWith('sb_secret_')) throw new Error('expected a public API key');
  // Reject a legacy service-role JWT accidentally passed as the public key.
  try {
    const payload = options.publishableKey.split('.')[1];
    if (payload && JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role') throw new Error('service-role key is not a public API key');
  } catch (e) { if (e instanceof Error && e.message === 'service-role key is not a public API key') throw e; }
  const f = options.fetcher ?? fetch;
  const integrity = (msg: string): never => { throw new HostedRequestError(502, 'integrity', msg); };
  async function request(path: string, body?: string, authenticated = true): Promise<unknown> {
    const token = authenticated ? await options.accessToken?.() : null;
    const headers: Record<string,string> = { apikey: options.publishableKey, accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) { headers['content-type'] = 'application/json'; headers['logline-version'] = '1'; }
    const res = await f(new URL(path, base), { headers, redirect: 'error', credentials: 'omit', cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', body }) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new HostedRequestError(res.status, typeof err.error === 'string' ? err.error : 'http', typeof err.message === 'string' ? err.message : `Supabase returned ${res.status}`);
    }
    return res.json();
  }
  async function row(table: string, field: string, value: string, select: string, authenticated = true): Promise<Record<string,unknown> | null> {
    const q = new URLSearchParams({ [field]: `eq.${value}`, select, limit: '1' });
    const rows = await request(`/rest/v1/${table}?${q}`, undefined, authenticated);
    if (!Array.isArray(rows) || rows.length > 1) return integrity('invalid lookup response');
    return rows[0] ?? null;
  }
  async function object(hash: string, authenticated = true): Promise<{value: unknown} | null> {
    if (!HASH_RE.test(hash)) throw new Error('invalid content address');
    const r = await row('objects', 'hash', hash, 'body', authenticated);
    if (!r) return null;
    if (typeof r.body !== 'string') return integrity('invalid CAS object');
    const value = parseStrict(r.body);
    if (canonicalize(value) !== r.body || await hashOf(value) !== hash) return integrity('CAS object does not match its address');
    return { value };
  }
  async function receipt(id: string): Promise<Receipt | null> {
    if (!HASH_RE.test(id)) throw new Error('invalid receipt address');
    const r = await row('receipts', 'id', id, 'receipt', false);
    if (!r) return null;
    if (typeof r.receipt !== 'string') return integrity('invalid receipt row');
    const value = parseStrict(r.receipt) as Receipt;
    if (canonicalize(value) !== r.receipt || value?.id !== id || !(await verify(value, options.keys)).valid) return integrity('receipt is not authentic at this address');
    return value;
  }
  return {
    // Native issuer discovery; do not send the caller's bearer token to it.
    async oauthMetadata() {
      const res = await f(new URL('/auth/v1/.well-known/oauth-authorization-server', base), { redirect: 'error', credentials: 'omit' });
      if (!res.ok) throw new HostedRequestError(res.status, 'oauth_metadata', 'OAuth discovery unavailable');
      return res.json(); // OAuth client must validate issuer and endpoint metadata before use.
    },
    receipt,
    object,
    async process(id: string): Promise<Process | null> {
      if (!FREQUENCY_RE.test(id)) throw new Error('invalid process id');
      const r = await row('processes', 'id', id, 'hash', false);
      if (!r) return null;
      if (typeof r.hash !== 'string') return integrity('invalid process address');
      const obj = await object(r.hash, false);
      if (!obj) return integrity('published law is missing');
      const law = obj.value as Process;
      validateProcess(law);
      if (law.id !== id) return integrity('published law id mismatch');
      return law;
    },
    async submit(tuple: unknown): Promise<HostedSubmission> {
      const body = canonicalize(tuple);
      const result = await request('/functions/v1/submit', body) as HostedSubmission;
      if (!result || typeof result.replayed !== 'boolean' || !result.detail || !(await verify(result.receipt, options.keys, { tuple: parseStrict(body), detail: result.detail })).valid) return integrity('submission result failed receipt verification');
      return result;
    },
    async publish(law: Process): Promise<{id: string; hash: string}> {
      validateProcess(law);
      const body = canonicalize(law);
      const result = await request('/functions/v1/publish', body) as {id: string; hash: string};
      if (result?.id !== law.id || result?.hash !== await hashOf(parseStrict(body))) return integrity('publication address mismatch');
      return result;
    },
    // Read private citation evidence under the caller's RLS, never through a service key.
    async citation(id: string) {
      const r = await receipt(id);
      if (!r) return null;
      const d = await object(r.header.detail_hash);
      return { receipt: r, ...(d ? { detail: d.value as Detail } : {}) };
    }
  };
}
