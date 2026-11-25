# LogLine Receipt

Run a free JSON tuple on a published JSON process. Get one signed receipt that anyone can verify without trusting the issuer. Receipts can cite other receipts by hash, so runs chain into **trajectories**, and every receipt is broadcast on its **frequency**.

```
tuple + process + when ──▶ machine ──▶ receipt
                                        ├─ header: public, signed, on air
                                        └─ detail: private, bound by hash
receipt ──cited by──▶ next tuple ──▶ next receipt ──▶ …   (a trajectory)
```

| Path | What |
|---|---|
| `HANDOFF.md` | Where this is going (stateless, Supabase), auth, and the design principles. Read it first |
| `SPEC.md` | LogLine Receipt v1, draft for freeze |
| `src/` | Reference library: TypeScript, no dependencies, WebCrypto only; the same code runs in Node, Bun and browsers |
| `src/ledger.ts` | Reference machine: an append-only, content-addressed ledger with the radio, trajectories and bundles |
| `processes/` | The first process: a course of 5 lessons, a certificate, and an alumni register that reacts to certificates on its own |
| `examples/course.mjs` | The course run end to end, with a fork attempt, impersonation and offline verification |
| `bin/logline.mjs` | CLI: `logline verify-bundle <bundle.json\|url> [--keys keys.json\|url]` |
| `server/` | The machine over HTTP: a durable, hash-chained ledger file and the routes below. Node only, no dependencies |
| `bin/logline-server.mjs` | `logline-server serve`, `account`, `head` |
| `vectors/` | Conformance vectors. JCS cases come from RFC 8785; receipt and citation goldens are signed with a test-only key |
| `supabase/migrations/` | Draft schema for hosting the ledger and the radio; not applied |

```bash
npm test          # build, then conformance + adversarial + trajectory suites in Node, Bun, Chromium
npm run example   # the course, start to certificate
```

`dist/` is prebuilt in the release zip, so `node examples/course.mjs` and `node bin/logline.mjs` work without a build.

## The first process: a course as a trajectory

- `course.lesson@1`: each lesson **cites the previous lesson's receipt**. The rules check that it's the same learner, the same course and the next lesson, with a score of at least 70. The receipt's grants carry `completed`, which the next lesson builds on. A cited lesson can be consumed only once, so a trajectory can't fork. A failed attempt consumes nothing, so it can be retried.
- `course.certificate.logline-101@1` **cites the last lesson**. Its rules require 5 completed lessons by the same learner. The certificate's bundle holds the whole trajectory, and every receipt in it is re-run by hash when it's verified.
- `alumni.logline-101@1` **listens to the radio**. When a certificate comes out `ok`, it reacts with a receipt of its own that cites the certificate. Nobody submits anything.

## The machine

- **Choreography.** Processes with `on` react to receipts on air. Loops are stopped by three limits: one reaction per trigger and process, a maximum depth, and a budget per submission. Halted reactions are reported.
- **Idempotency.** The same submission from the same person in the same time window returns the receipt that already exists. A retry never decides twice and never consumes twice.
- **Strict input.** `submitText` parses I-JSON and refuses duplicate keys, lone surrogates and integers that would be silently rounded.

## Run a machine

```bash
npm run build
node bin/logline-server.mjs account root --admin     # prints a bearer token, once
node bin/logline-server.mjs account ana
node bin/logline-server.mjs serve --port 8080 --publish processes
```

Everything lives in `./data` (or `--data DIR`): `ledger.jsonl`, the machine key and the pseudonym secret, both mode 0600. Back up the whole directory; losing the key means the machine can't restore its own ledger.

| Route | Who | What |
|---|---|---|
| `GET /.well-known/logline.json` | anyone | published keys, limits and the ledger head `{n, hash}` |
| `GET /processes`, `GET /processes/:hash` | anyone | the published law, by content address |
| `POST /processes` | admin | publish a process; an id can't be republished (409), amend under a new id |
| `POST /submit` | anyone; a token sets `by` | I-JSON body → `{receipt, detail, replayed, reactions, halted}`; 201 new, 200 replayed |
| `GET /receipts/:id` | anyone | the signed public header and its `seq` |
| `GET /receipts/:id/detail`, `/bundle` | its submitter, or admin | the private parts; the bundle verifies offline |
| `GET /history?…&after=&limit=` | anyone | past receipts, paged by `seq` |
| `GET /radio?…` | anyone | Server-Sent Events, one `receipt` event per broadcast; resumes from `Last-Event-ID` |
| `GET /me` | token | your account and on-air pseudonym |

Tuning parameters are `frequency`, `status`, `by`, `process_hash` (comma lists; `course.*` patterns) and `activated`. `by=me` means your pseudonym.

```bash
curl -N 'http://localhost:8080/radio?frequency=course.*&status=ok'
curl -X POST -H "authorization: Bearer $TOKEN" localhost:8080/submit -d @tuple.json
LOGLINE_TOKEN=$TOKEN node bin/logline.mjs verify-bundle http://localhost:8080/receipts/$ID/bundle --keys http://localhost:8080
```

**What the server guarantees**

- **Durable before acknowledged.** Every record is appended and fsynced before the receipt is returned or broadcast. After a storage error the machine refuses writes (503) instead of continuing in memory.
- **The log can't be quietly edited.** Lines are hash-chained, and on start every receipt is re-checked: signature, detail, tuple and process by hash. The consumption, idempotency and reaction state is recomputed, never stored. A torn last line from a crash is dropped (it was never acknowledged); any other change refuses to start. `serve --replay` also re-runs every decision.
- **One decision per submission.** Writes are serialized, so identical requests racing each other produce one receipt.
- **Private by default.** On air: only the signed header. Tuples and details: only their submitter (by pseudonym) or an admin. Anonymous submissions get their detail in the response and nowhere else.
- **Limits answer with reasons.** Body size (413), submissions per caller (429 with `Retry-After`), strict I-JSON (400 `ijson`). A radio listener that can't keep up is disconnected and resumes from `Last-Event-ID`.

Not yet: key rotation, encrypted objects with erasure, an external anchor for the head, TLS (put it behind a reverse proxy). One process, one file: it is a single-writer machine.

## Use the library

```js
import { MemoryLedger, generateMachineKey, verifyBundle } from "@logline/receipt";
const ledger = new MemoryLedger((await generateMachineKey()).key);
await ledger.publish(process);
ledger.listen({ frequency: "course.*", status: "ok" }, (receipt) => { /* the radio */ });
const { receipt } = await ledger.submit(tuple, { by: pseudonym });
const verdict = await verifyBundle(ledger.bundle(receipt.id), publishedKeys);
```

MIT licensed.
