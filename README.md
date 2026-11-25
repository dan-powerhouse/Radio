# @logline/receipt

Run a free JSON tuple on a published JSON process. Get one signed receipt that anyone can verify without trusting the issuer. Every receipt is broadcast on its frequency.

```
tuple.json + process.json + when ──▶ machine ──▶ receipt (signed header on air, detail by hash)
```

- `SPEC.md`: LogLine Receipt v1, draft for freeze
- `src/`: the reference library. TypeScript, no dependencies, WebCrypto only. The same code runs in Node, Bun and browsers.
- `vectors/`: conformance vectors. JCS cases come from RFC 8785; receipt goldens are signed with a test-only key.
- `supabase/migrations/`: draft schema for the CAS, the ledger and the radio. Not applied yet.

```bash
npm test   # build, then conformance and adversarial suites in Node, Bun and Chromium
```

## Use

```js
import { issue, verify, tuned } from "@logline/receipt";
const { receipt, detail } = await issue(machineKey, process, tuple, { when, by });
const verdict = await verify(receipt, publishedKeys, { detail, tuple, process });
if (tuned({ frequency: "visa.*", status: "ok" }, receipt.header)) { /* react */ }
```
