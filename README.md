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
| `SPEC.md` | LogLine Receipt v1, draft for freeze |
| `src/` | Reference library: TypeScript, no dependencies, WebCrypto only; the same code runs in Node, Bun and browsers |
| `src/ledger.ts` | Reference machine: an append-only, content-addressed ledger with the radio, trajectories and bundles |
| `processes/` | The first process: a course of 5 lessons, ending in a certificate |
| `examples/course.mjs` | The course run end to end, with a fork attempt, impersonation and offline verification |
| `bin/logline.mjs` | CLI: `logline verify-bundle bundle.json [--keys keys.json]` |
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

## Use

```js
import { MemoryLedger, generateMachineKey, verifyBundle } from "@logline/receipt";
const ledger = new MemoryLedger((await generateMachineKey()).key);
await ledger.publish(process);
ledger.listen({ frequency: "course.*", status: "ok" }, (receipt) => { /* the radio */ });
const { receipt } = await ledger.submit(tuple, { by: pseudonym });
const verdict = await verifyBundle(ledger.bundle(receipt.id), publishedKeys);
```

MIT licensed.
