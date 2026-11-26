import { canonicalize } from './jcs.js';
import { HASH_RE, hashOf } from './hash.js';
import { parseStrict } from './strict.js';
import { authenticV2, parseSubmissionV2 } from './run-v2.js';
import type { ContextV1, DetailV2, ReceiptV2, SubmissionV2 } from './run-v2.js';
import { HostedRequestError } from './hosted.js';
import type { HostedOptions } from './hosted.js';
import { tuned } from './radio.js';
import type { Tuning } from './radio.js';

export interface HistoryRequest { tuning?: Tuning; after?: string; limit?: number }
export interface HistoryPage { items: ReceiptV2[]; next: string | null; checkpoint: string | null }
export interface HostedSubmissionV2 { receipt: ReceiptV2; detail: DetailV2; context: ContextV1; replayed: boolean }
export interface ParticipantRealtimeChannel {
  on(type: 'broadcast', filter: { event: 'receipt' }, receive: (message: { payload: unknown }) => void): ParticipantRealtimeChannel;
  subscribe(callback: (status: string, error?: Error) => void): ParticipantRealtimeChannel;
  unsubscribe(): PromiseLike<unknown>;
}
export interface ParticipantRealtime {
  channel(name: string, options: { config: { private: true } }): ParticipantRealtimeChannel;
  setAuth(token: string): void | PromiseLike<void>;
}
export interface ParticipantListener {
  tuning?: Tuning;
  /** Required for by=me. This is the participant's attested pseudonym. */
  by?: string;
  checkpoint: { load(): string | null | Promise<string | null>; save(value: string): void | Promise<void> };
  seen: { has(id: string): boolean | Promise<boolean>; add(id: string): unknown };
  receive(receipt: ReceiptV2): void | Promise<void>;
  onError(error: unknown): void;
}

export function hostedClientV2(options: HostedOptions) {
  const base = new URL(options.url);
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) ||
      base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw new Error('expected a Supabase origin');
  if (!options.publishableKey || options.publishableKey.startsWith('sb_secret_'))
    throw new Error('expected a public API key');
  let role: unknown;
  try { role = JSON.parse(atob(options.publishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role; }
  catch { /* A current publishable key is not a JWT. */ }
  if (role === 'service_role') throw new Error('expected a public API key');

  const send = options.fetcher ?? fetch;
  const invalid = (): never => { throw new HostedRequestError(502,'integrity','invalid or unverified RADIO response'); };
  async function token() {
    const value = await options.accessToken?.();
    if (!value) throw new HostedRequestError(401,'unauthenticated','a current Supabase credential is required');
    return value;
  }
  async function request(path: string, body?: string, signal?: AbortSignal): Promise<unknown> {
    const response = await send(new URL('/functions/v1/' + path,base), {
      method: body === undefined ? 'GET' : 'POST', body, signal,
      redirect:'error', credentials:'omit', cache:'no-store',
      headers:{apikey:options.publishableKey,authorization:'Bearer ' + await token(),
        'logline-version':'2','content-type':'application/json'}
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new HostedRequestError(response.status,typeof data?.error === 'string' ? data.error : 'http',
        'RADIO request failed');
    }
    if (response.headers.get('logline-version') !== '2') invalid();
    try { return parseStrict(await response.text(),70); }
    catch { return invalid(); }
  }
  async function receipt(id: string, signal?: AbortSignal) {
    if (id.length !== 71 || !HASH_RE.test(id)) throw new Error('invalid receipt address');
    const result = await request('receipt?' + new URLSearchParams({id}),undefined,signal) as {receipt:ReceiptV2};
    if (result?.receipt?.id !== id || !await authenticV2(result.receipt,options.keys)) invalid();
    return result.receipt;
  }
  async function history(query: HistoryRequest, signal?: AbortSignal): Promise<HistoryPage> {
    const result = await request('history',canonicalize(query),signal) as HistoryPage;
    const cursor = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 2048;
    if (!result || !Array.isArray(result.items) || result.items.length > (query.limit ?? 100) ||
        !((result.next === null && cursor(result.checkpoint)) || (cursor(result.next) && result.checkpoint === null))) invalid();
    for (const item of result.items) if (!await authenticV2(item,options.keys)) invalid();
    return result;
  }
  async function submit(submission: SubmissionV2, signal?: AbortSignal): Promise<HostedSubmissionV2> {
    const text = canonicalize(submission);
    const input = parseSubmissionV2(text);
    const result = await request('submit',text,signal) as HostedSubmissionV2;
    if (!result?.detail || !result.context || typeof result.replayed !== 'boolean' ||
        !await authenticV2(result.receipt,options.keys)) invalid();
    const header = result.receipt.header;
    if (header.input_hash !== await hashOf(input.tuple) || header.detail_hash !== await hashOf(result.detail) ||
        header.context_hash !== await hashOf(result.context) || result.context.submission !== input.submission ||
        result.context.request_hash !== await hashOf({tuple:input.tuple,continue:input.continue ?? null})) invalid();
    return result;
  }

  async function listen(realtime: ParticipantRealtime, state: ParticipantListener) {
    const controller = new AbortController();
    const {signal} = controller;
    const tuning = {...state.tuning};
    if (tuning.by !== undefined) {
      const alternatives = Array.isArray(tuning.by) ? tuning.by : [tuning.by];
      if (alternatives.includes('me') && !state.by) throw new Error('attested pseudonym required for by=me');
      tuning.by = alternatives.map(value => value === 'me' ? state.by! : value);
      tuning.by = [...new Set(tuning.by)];
    }
    const active = new Map<string,Promise<void>>();
    async function deliver(item: ReceiptV2) {
      if (signal.aborted || !tuned(tuning,item.header)) return;
      const running = active.get(item.id);
      if (running) return running;
      const delivery = (async () => {
        if (await state.seen.has(item.id) || signal.aborted) return;
        await state.receive(item);
        await state.seen.add(item.id);
      })();
      active.set(item.id,delivery);
      try { await delivery; }
      finally { active.delete(item.id); }
    }
    let pending: Promise<void> | undefined;
    let requested = false;
    function catchUp() {
      requested = true;
      pending ??= (async () => {
        try {
          while (requested && !signal.aborted) {
            requested = false;
            let after = await state.checkpoint.load();
            while (!signal.aborted) {
              const page = await history({tuning,...(after !== null ? {after} : {})},signal);
              for (const item of page.items) await deliver(item);
              if (signal.aborted) break;
              if (page.checkpoint !== null) {
                await state.checkpoint.save(page.checkpoint);
                break;
              }
              if (page.next === after) invalid();
              after = page.next;
            }
          }
        } finally {
          pending = undefined;
        }
      })();
      return pending;
    }
    const report = (error: unknown) => { if (!signal.aborted) state.onError(error); };
    const refresh = async () => { await realtime.setAuth(await token()); };
    await refresh();
    const channel = realtime.channel('radio:v2:receipts',{config:{private:true}});
    const resolving = new Set<string>();
    channel.on('broadcast',{event:'receipt'},({payload}) => {
      const id = (payload as {id?:unknown} | null)?.id;
      if (signal.aborted || typeof id !== 'string' || id.length !== 71 || !HASH_RE.test(id) || resolving.has(id)) return;
      // Durable catch-up is the recovery path if a burst exceeds the live read budget.
      if (resolving.size >= 16) {
        void catchUp().catch(report);
        return;
      }
      resolving.add(id);
      void receipt(id,signal).then(deliver).catch(report).finally(() => { resolving.delete(id); });
    }).subscribe((status,error) => {
      if (status === 'SUBSCRIBED') void catchUp().catch(report);
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        report(error ?? new HostedRequestError(503,'unavailable','Realtime subscription unavailable'));
    });
    return { catchUp, refresh, async close() { controller.abort(); await channel.unsubscribe(); } };
  }
  return {receipt,history,submit,listen};
}
