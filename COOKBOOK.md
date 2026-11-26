<!-- Generated from docs/radio-capabilities.json by scripts/cookbook.mjs. -->
# RADIO Protocol 1.0 Cookbook

Use these recipes to publish a law, submit a Contract, understand the resulting receipt and verify a trajectory. The procedures apply to any conforming implementation. Each adapter documents its own endpoints, credentials, deployment limits and hosted acceptance evidence. [Supabase materialization](supabase/README.md)

[SPEC.md](SPEC.md) defines the protocol. The [capability catalog](docs/radio-capabilities.json) records how to use it. Examples come from the [pinned conformance corpus](vectors/corpus.json). Fixture nonces and keys are for tests. Lines marked as excerpts show selected fields for reading.

In a repository checkout, use `npm ci` and `npm run example` for an executable course trajectory. Run `npm test` to check the rendered cookbook and execute the reference conformance suite.

## Recipes

- [Discover a machine and its laws](#discover-a-machine-and-its-laws)
- [Publish or retire a Process Type](#publish-or-retire-a-process-type)
- [Start a Process with a Contract](#start-a-process-with-a-contract)
- [Read the cause and consequence of a receipt](#read-the-cause-and-consequence-of-a-receipt)
- [Continue an existing trajectory](#continue-an-existing-trajectory)
- [Cite evidence and consume it once](#cite-evidence-and-consume-it-once)
- [Retry without creating a second effect](#retry-without-creating-a-second-effect)
- [Read a receipt and its authorized evidence](#read-a-receipt-and-its-authorized-evidence)
- [Verify a trajectory offline](#verify-a-trajectory-offline)
- [Tune the radio and catch up after disconnect](#tune-the-radio-and-catch-up-after-disconnect)
- [Package a law with DIPLOMACY Skills](#package-a-law-with-diplomacy-skills)

## Discover a machine and its laws

Find the supported submission version and the rules that apply in the Institution.

### Procedure

1. Identify the Institution and obtain its trusted machine keys through an independent channel.
2. Read the machine discovery metadata for the supported transport versions and request limits.
3. Read the active Registry separately under current authority, then fetch the Process Types you need by content hash.

### Outcome

- Discovery can be cached for its advertised lifetime. The active Registry and current permissions have their own freshness requirements.
- Discovery keys are convenient public material. Pin trust to the Institution before verifying a receipt.

**Contract** [§15.8.2](SPEC.md#1582-registry-snapshot) · [§15.18.1](SPEC.md#15181-institution-identity-and-authority) · [§15.18.3](SPEC.md#15183-stateless-request-result-discovery-and-evidence)

**JSON shapes** [MachineDiscovery](contracts/radio.schema.json) · [Registry](contracts/radio.schema.json) · [ProcessType](contracts/radio.schema.json) · [KeyRing](contracts/radio.schema.json)

**Reference evidence** [boundary-contracts.test.mjs](test/boundary-contracts.test.mjs) · [process-type.test.mjs](test/process-type.test.mjs)

## Publish or retire a Process Type

Define a reusable procedure with recognition, entry conditions, successor conditions and consequences.

### Procedure

1. Author a `process-type@1` law. Give its first RUN an empty `after` and declare each successor's parent RUN names.
2. Write `recognize` against tuple data. Declare the fields in `requires`, the checks in `steps`, and the success grants and consequences in the RUN.
3. Submit the law through the Institution's authorized publication operation. Record the resulting law hash and Registry snapshot.
4. To retire a law, use the Institution's authorized retirement operation for its published identifier. Capture the new Registry snapshot.

### Outcome

- Publishing the same law is idempotent. A revised law has a new content address and versioned identifier.
- Retirement changes the active Registry for new entries. Existing trajectories still refer to their bound law.

The complete law used by the entry and review recipes. [run-v2.json](vectors/run-v2.json)

~~~json
{
  "logline": "process-type@1",
  "id": "blue@1",
  "issuer": "Example",
  "recognize": {
    "and": [
      {
        "has": "did"
      },
      {
        "==": [
          {
            "var": "did"
          },
          "request"
        ]
      }
    ]
  },
  "runs": [
    {
      "id": "open",
      "after": [],
      "requires": {
        "with.subject": "string"
      },
      "steps": [],
      "grants": {
        "subject": {
          "var": "with.subject"
        },
        "owner": {
          "var": "$by"
        }
      },
      "if_ok": "Opened",
      "if_not": "Not opened",
      "if_doubt": "Open undecided"
    },
    {
      "id": "review",
      "after": [
        "open"
      ],
      "requires": {
        "with.score": "integer"
      },
      "steps": [
        {
          "id": "owner",
          "check": {
            "==": [
              {
                "var": "$by"
              },
              {
                "var": "$parents.open.detail.grants.owner"
              }
            ]
          },
          "if_not": "not",
          "reason": "Owner required"
        },
        {
          "id": "score",
          "check": {
            ">=": [
              {
                "var": "with.score"
              },
              70
            ]
          },
          "if_not": "not",
          "reason": "Score below 70"
        }
      ],
      "grants": {
        "owner": {
          "var": "$by"
        }
      },
      "if_ok": "Reviewed",
      "if_not": "Not reviewed",
      "if_doubt": "Review undecided"
    }
  ]
}
~~~

**Contract** [§15.8.1](SPEC.md#1581-law-and-publication) · [§15.8.2](SPEC.md#1582-registry-snapshot) · [§15.9.1](SPEC.md#1591-law-and-run-definitions) · [§15.10](SPEC.md#1510-pr-03--reference-publication-profile)

**JSON shapes** [ProcessType](contracts/radio.schema.json) · [Run](contracts/radio.schema.json) · [Registry](contracts/radio.schema.json)

**Reference evidence** [process-type.test.mjs](test/process-type.test.mjs) · [contracts.test.mjs](test/contracts.test.mjs)

## Start a Process with a Contract

Ask the Institution to recognize a free tuple and attempt the first RUN.

### Procedure

1. Draft the tuple with the Process Type and any adopted Skill in view. LogLine's `who`, `did`, `this` and `with` help the author name the entities, action, object and context. Use the Skill to identify relevant evidence and missing facts before submitting.
2. Generate a fresh `submission` nonce, for example 16 cryptographically random bytes encoded as unpadded base64url. Authenticate and send the `tuple` and `submission` with `continue` omitted.
3. Read the committed receipt. Use its ID as the instance ID when an entry RUN succeeds.

### Outcome

- The scanner uses the admitted Registry. A unique match selects the entry RUN, which still needs to satisfy its activation conditions.
- A committed `ok` entry has `header.instance: null`. Its own receipt ID identifies the Process instance.
- A scalar is a valid tuple shape. The applicable law determines whether it is recognized. The machine derives `by` from the verified participant.

Entry request for `blue@1` using the LogLine fields its law needs. [receipt-v2-contract.json · entry-A](vectors/receipt-v2-contract.json)

~~~json
{
  "tuple": {
    "did": "request",
    "with": {
      "subject": "A"
    }
  },
  "submission": "AQEBAQEBAQEBAQEBAQEBAQ"
}
~~~

Submission accepted by the scalar fixture's law. [run-v2.json · free-scalar](vectors/run-v2.json)

~~~json
{
  "tuple": 42,
  "submission": "DQ0NDQ0NDQ0NDQ0NDQ0NDQ"
}
~~~

**Contract** [§15.8.3](SPEC.md#1583-recognition-is-not-activation) · [§15.8.4](SPEC.md#1584-disposition) · [§15.9.2](SPEC.md#1592-submission-and-continuity) · [§15.9.3](SPEC.md#1593-evaluation-constitution-and-uniqueness)

**JSON shapes** [Submission](contracts/radio.schema.json) · [Recognition](contracts/radio.schema.json) · [SubmitResult](contracts/radio.schema.json) · [ReceiptV2](contracts/radio.schema.json)

**Reference evidence** [scanner-conformance.test.mjs](test/scanner-conformance.test.mjs) · [run-v2-conformance.test.mjs](test/run-v2-conformance.test.mjs) · [process-ledger-conformance.test.mjs](test/process-ledger-conformance.test.mjs)

## Read the cause and consequence of a receipt

Determine how far a submission progressed and what institutional effect it constituted.

### Procedure

1. Read `receipt.header.status` and `activated` to distinguish registration from evaluation.
2. With disclosure authority, inspect `detail.reason`, `detail.unmet` and `detail.findings` for recognition, activation or RUN diagnostics. Inspect `detail.consequence` for the recorded consequence and `detail.grants` for the structured result.
3. Handle a `BoundaryFailure` at the request boundary. Before retrying an interrupted write, recover the submission by its nonce.

### Outcome

- `registered` records an admitted attempt that failed to activate. `not` and `doubt` record evaluated outcomes.
- `ok` records success under the law. Grants are evaluated on that path. The text in `consequence` and the structured fields in `grants` serve different purposes.
- Use structured status and reason codes for application control flow. Preserve the consequence and findings for explanation.

Registration after no law matches (excerpt). [run-v2.json · no-match](vectors/run-v2.json)

~~~json
{
  "status": "registered",
  "activated": false,
  "reason": "recognition_none",
  "findings": [],
  "consequence": "Recorded. The RUN did not activate.",
  "grants": null
}
~~~

Evaluation where a negative finding decides the outcome (excerpt). [run-v2.json · not-precedes-doubt](vectors/run-v2.json)

~~~json
{
  "status": "not",
  "activated": true,
  "reason": "check_not",
  "findings": [
    {
      "step": "unknown",
      "result": "doubt",
      "reason": "Unknown",
      "error": "eval_missing"
    },
    {
      "step": "denied",
      "result": "not",
      "reason": "Denied"
    }
  ],
  "consequence": "Rejected",
  "grants": null
}
~~~

Evaluation with an unresolved condition (excerpt). [run-v2.json · declared-doubt](vectors/run-v2.json)

~~~json
{
  "status": "doubt",
  "activated": true,
  "reason": "check_doubt",
  "findings": [
    {
      "step": "conditional",
      "result": "doubt",
      "reason": "Insufficient"
    }
  ],
  "consequence": "Undecided",
  "grants": null
}
~~~

Successful review with its law-defined grant (excerpt). [run-v2.json · retired-law-continuation](vectors/run-v2.json)

~~~json
{
  "status": "ok",
  "activated": true,
  "reason": null,
  "findings": [
    {
      "step": "owner",
      "result": "ok"
    },
    {
      "step": "score",
      "result": "ok"
    }
  ],
  "consequence": "Reviewed",
  "grants": {
    "owner": "p:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
~~~

**Contract** [§15.8.4](SPEC.md#1584-disposition) · [§15.9.3](SPEC.md#1593-evaluation-constitution-and-uniqueness) · [§15.12.1](SPEC.md#15121-decision-boundary-architect-approved-2026-11-26) · [§15.18.3](SPEC.md#15183-stateless-request-result-discovery-and-evidence)

**JSON shapes** [Status](contracts/radio.schema.json) · [DetailV2](contracts/radio.schema.json) · [Finding](contracts/radio.schema.json) · [ReasonCode](contracts/radio.schema.json) · [BoundaryFailure](contracts/radio.schema.json)

**Reference evidence** [run-v2-conformance.test.mjs](test/run-v2-conformance.test.mjs) · [boundary-contracts.test.mjs](test/boundary-contracts.test.mjs)

## Continue an existing trajectory

Propose the next movement under the law bound by the successful entry receipt.

### Procedure

1. Find the successful entry receipt and the intended successor RUN in its bound Process Type.
2. Collect one eligible parent receipt for each name in the successor's `after`. Put the root ID in `continue.instance`, the RUN name in `continue.run`, and the parent addresses in `continue.parents`.
3. Submit a new tuple and nonce with that continuation. Check the returned receipt for the bound instance, RUN and result.

### Outcome

- The continuation uses the historical law even after retirement. It checks the current participant's authority and the explicit parent roles.
- A missing or incorrect parent yields a registered attempt with `parents_unmet` when the law is known and the condition can be disclosed. Only an `ok` successor fills the unique success claim for that instance and RUN.

Review submission referencing the signed entry receipt. [receipt-v2-contract.json · review-A](vectors/receipt-v2-contract.json)

~~~json
{
  "tuple": {
    "with": {
      "score": 80
    }
  },
  "submission": "AwMDAwMDAwMDAwMDAwMDAw",
  "continue": {
    "instance": "sha256:e9de6b2e19edc95e2d3f90c97f93aca69c04c895659611f1328eb057b1d17061",
    "run": "review",
    "parents": {
      "open": "sha256:e9de6b2e19edc95e2d3f90c97f93aca69c04c895659611f1328eb057b1d17061"
    }
  }
}
~~~

**Contract** [§15.9.2](SPEC.md#1592-submission-and-continuity) · [§15.9.3](SPEC.md#1593-evaluation-constitution-and-uniqueness) · [§15.14](SPEC.md#1514-pr-06--reference-instance-formation-and-recovery) · [§15.15](SPEC.md#1515-pr-07--atomic-uniqueness-and-retry-acceptance)

**JSON shapes** [Continuation](contracts/radio.schema.json) · [Submission](contracts/radio.schema.json) · [ReceiptV2](contracts/radio.schema.json) · [ContextV1](contracts/radio.schema.json)

**Reference evidence** [process-ledger-conformance.test.mjs](test/process-ledger-conformance.test.mjs) · [run-v2-conformance.test.mjs](test/run-v2-conformance.test.mjs) · [atomic-conformance.test.mjs](test/atomic-conformance.test.mjs)

## Cite evidence and consume it once

Use a prior receipt as evidence in a law-defined slot with optional exclusivity.

### Procedure

1. Read the RUN's declared `cites` slots and their conditions. Put the address in `tuple.cites` under the selected slot name.
2. Submit with current authority to use the evidence. The machine resolves and verifies the cited receipt and detail at its authoritative boundary.
3. For a `once` slot, treat a claim as consumed only after the new `ok` receipt commits.

### Outcome

- The `once` scope combines the consuming law hash, slot name and cited receipt ID. RUNs of the same law that share a slot name share that scope.
- A spent claim prevents activation. If two candidates race for the same claim, the losing attempt uses updated authoritative observations.

Submission proposing an already consumed citation. [run-v2.json · spent-citation](vectors/run-v2.json)

~~~json
{
  "tuple": {
    "cites": {
      "proof": "sha256:3a2c0214dec514a6c27a59883a018125d99ce524a36af0baa920a8adcc1c6284"
    }
  },
  "submission": "Hh4eHh4eHh4eHh4eHh4eHg"
}
~~~

Disposition of that attempt (excerpt). [run-v2.json · spent-citation](vectors/run-v2.json)

~~~json
{
  "status": "registered",
  "reason": "citation_spent",
  "observedSpending": [
    {
      "slot": "proof",
      "id": "sha256:3a2c0214dec514a6c27a59883a018125d99ce524a36af0baa920a8adcc1c6284"
    }
  ]
}
~~~

**Contract** [§15.9.1](SPEC.md#1591-law-and-run-definitions) · [§15.9.3](SPEC.md#1593-evaluation-constitution-and-uniqueness) · [§15.15](SPEC.md#1515-pr-07--atomic-uniqueness-and-retry-acceptance) · [§15.18.1](SPEC.md#15181-institution-identity-and-authority)

**JSON shapes** [Citation](contracts/radio.schema.json) · [Submission](contracts/radio.schema.json) · [SpentClaim](contracts/radio.schema.json) · [ResolvedObservations](contracts/radio.schema.json)

**Reference evidence** [run-v2-conformance.test.mjs](test/run-v2-conformance.test.mjs) · [atomic-conformance.test.mjs](test/atomic-conformance.test.mjs) · [postgres-v2.integration.mjs](test/postgres-v2.integration.mjs)

## Retry without creating a second effect

Recover the committed outcome when a response was lost or the executor changed.

### Procedure

1. Retain the nonce and the complete Submission, including any explicit continuation.
2. Resend the same request under the same authenticated principal and current authorization.
3. Use a fresh nonce for a new attempt, including when you change the tuple or continuation.

### Outcome

- When the earlier attempt committed, an authorized retry with unchanged intent returns the original signed objects with `replayed: true`. The response may come from a replacement executor.
- Reusing the nonce with different intent returns `submission_conflict`. If authority was withdrawn, recovery of private results is denied.

**Contract** [§15.9.3](SPEC.md#1593-evaluation-constitution-and-uniqueness) · [§15.15](SPEC.md#1515-pr-07--atomic-uniqueness-and-retry-acceptance) · [§15.18.2](SPEC.md#15182-freshness-and-revocation) · [§15.18.3](SPEC.md#15183-stateless-request-result-discovery-and-evidence)

**JSON shapes** [Submission](contracts/radio.schema.json) · [SubmissionKeyInput](contracts/radio.schema.json) · [RequestHashInput](contracts/radio.schema.json) · [SubmitResult](contracts/radio.schema.json) · [BoundaryFailure](contracts/radio.schema.json)

**Reference evidence** [atomic-conformance.test.mjs](test/atomic-conformance.test.mjs) · [edge-v2.integration.mjs](test/edge-v2.integration.mjs)

## Read a receipt and its authorized evidence

Retrieve the public signed envelope and inspect private decision inputs when permitted.

### Procedure

1. Read the receipt by ID through the Institution's authorized visibility surface.
2. Request `PrivateEvidence` separately to inspect the original tuple, detail and context. Compare their addresses with `input_hash`, `detail_hash` and `context_hash` in the header.
3. Obtain a full bundle only when the applicable disclosure policy allows access to every private constituent.

### Outcome

- A public receipt envelope carries signed metadata and law-approved public projections within the Institution's visibility policy.
- Formal use of a citation and raw disclosure of its private evidence are distinct permissions. Treat absent and denied private evidence alike where existence is protected.

**Contract** [§15.9.4](SPEC.md#1594-versioned-receipt-and-replay-evidence) · [§15.18.1](SPEC.md#15181-institution-identity-and-authority) · [§15.18.3](SPEC.md#15183-stateless-request-result-discovery-and-evidence)

**JSON shapes** [ReceiptV2](contracts/radio.schema.json) · [PrivateEvidence](contracts/radio.schema.json) · [BundleV2](contracts/radio.schema.json) · [BoundaryFailure](contracts/radio.schema.json)

**Reference evidence** [boundary-contracts.test.mjs](test/boundary-contracts.test.mjs) · [run-v2.test.mjs](test/run-v2.test.mjs) · [edge-v2.integration.mjs](test/edge-v2.integration.mjs)

## Verify a trajectory offline

Check who signed the receipt, reproduce its decision and verify its supplied causal closure.

### Procedure

1. Obtain the authorized `bundle@2` and independently trusted machine keys.
2. Run `verifyBundleV2` from the reference library or `node bin/logline.mjs verify-bundle bundle.json --keys trusted-keys.json` in a built checkout.
3. Read `authenticity`, `replay` and `trajectory` separately. For an incomplete verdict, retrieve the missing objects under current disclosure policy and verify again.

### Outcome

- The verifier recognizes a valid trajectory when all three checks pass.
- The result covers the supplied evidence closure. Global completeness and the truth of external facts are separate questions.

Head of the signed review bundle (excerpt). [receipt-v2-contract.json · review-A](vectors/receipt-v2-contract.json)

~~~json
{
  "logline": "bundle@2",
  "head": "sha256:ef40503ef907b7cc9c3f881ed5726a95fbfd7f31c2683c3aa832770eb77599b0"
}
~~~

**Contract** [§15.9.4](SPEC.md#1594-versioned-receipt-and-replay-evidence) · [§15.16](SPEC.md#1516-pr-08--portable-trajectory-verification) · [§15.18.3](SPEC.md#15183-stateless-request-result-discovery-and-evidence)

**JSON shapes** [BundleV2](contracts/radio.schema.json) · [KeyRing](contracts/radio.schema.json) · [VerificationVerdict](contracts/radio.schema.json)

**Reference evidence** [bundle-v2-conformance.test.mjs](test/bundle-v2-conformance.test.mjs) · [vector-audit.test.mjs](test/vector-audit.test.mjs)

## Tune the radio and catch up after disconnect

Observe committed receipts and recover the authorized institutional history.

### Procedure

1. Choose permitted tuning by frequency, status, actor, law hash or activation. Verify signed receipts against pinned machine keys before acting.
2. Read history with the same visibility and tuning. Follow `next` until the response supplies a completed-window `checkpoint`.
3. Save that checkpoint and deduplicate overlapping history and live notifications by verified receipt ID. Restart authorized history when the cursor scope changes.

### Outcome

- The contract includes late commits in a later completed window. The durable history boundary owns the checkpoint.
- The local reference exercises listener replacement. The PostgreSQL profile tests closed windows with real concurrent commits and the participant adapter tests overlap with live delivery.

Closed-window acceptance scenario. [boundary-review.json · late-commit](vectors/boundary-review.json)

~~~json
{
  "given": "A allocates physical sequence 10, B allocates 11 and commits first, scan finishes, then A commits",
  "expect": "next completed window includes A; B not skipped"
}
~~~

**Contract** [§15.17](SPEC.md#1517-pr-09--local-continuity-demonstration) · [§15.18.2](SPEC.md#15182-freshness-and-revocation) · [§15.18.4](SPEC.md#15184-radio-and-closed-window-history)

**JSON shapes** [ReceiptNotice](contracts/radio.schema.json) · [Tuning](contracts/radio.schema.json) · [HistoryRequest](contracts/radio.schema.json) · [HistoryPage](contracts/radio.schema.json)

**Reference evidence** [continuity-conformance.test.mjs](test/continuity-conformance.test.mjs) · [boundary-contracts.test.mjs](test/boundary-contracts.test.mjs) · [postgres-v2.integration.mjs](test/postgres-v2.integration.mjs) · [hosted-v2.test.mjs](test/hosted-v2.test.mjs)

## Package a law with DIPLOMACY Skills

Distribute instructions that help a participant draft a Contract for an exact law.

### Procedure

1. Include the canonical `process-type.json` and Agent Skills under `skills/<name>/SKILL.md`. Use the Skills to explain how to express intent, supply evidence and read consequences.
2. Record the exact file digests for `process-type.json` and all Skill files in `diplomacy.json`. Validate the ZIP in a built checkout with `node bin/diplomacy.mjs package.zip`.
3. Record the verified package and law hashes. Apply the Institution's adoption and distribution policy before exposing the package to participants.

### Outcome

- A Skill revision changes the package ID. The law hash remains stable when its canonical bytes stay the same.
- Skills guide participation. The published JSON law governs execution and the Institution grants authority.

Manifest from the reviewed `blue@1` package. [boundary-review.json](vectors/boundary-review.json)

~~~json
{
  "logline": "diplomacy@1",
  "files": {
    "process-type.json": "sha256:dc26c29e0b6f333efc2cbdee754ce7664778e897b69b9091eed152e50a51fd63",
    "skills/participant/SKILL.md": "sha256:d5c156ceccba3552ee6e0a0abd135eb4e4ffed6d2b339c113de5be96177c422d",
    "skills/observer/SKILL.md": "sha256:1b72948f49efe3b8a9372d7f293016ba8fa063ab5bbb16ec4d43f67383982c4c"
  }
}
~~~

**Contract** [§15.4](SPEC.md#154-diplomacy-and-agent-skills-interoperability--adopted-conceptual-direction) · [§15.18.5](SPEC.md#15185-diplomacy-minimal-package)

**JSON shapes** [DiplomacyManifest](contracts/radio.schema.json) · [DiplomacyPath](contracts/radio.schema.json) · [SkillName](contracts/radio.schema.json) · [ProcessType](contracts/radio.schema.json)

**Reference evidence** [diplomacy.test.mjs](test/diplomacy.test.mjs) · [boundary-contracts.test.mjs](test/boundary-contracts.test.mjs)
