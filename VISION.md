# RADIO — Vision

RADIO starts with LogLine. A person or an agent can put an event or intention into a short, structured expression that others can examine and act on. RADIO gives an Institution a way to consider that expression under a published law and preserve the result for the next participant.

## From a LogLine to a trajectory

LogLine is the preferred convention for writing Contracts. A Skill can use `who`, `did`, `this` and `with` to help a person or LLM name the entities, describe an event or proposed action and find the context and evidence the law expects. Writing the expression can surface an ambiguous reference or a missing fact before submission. Common fields, shared action terms and stable references make authorized projections easier to query across domains.

A participant submits the Contract as a free I-JSON tuple. On an initial submission, the scanner checks the published Process Types. The applicable law defines the possible RUNs and their conditions. An admitted expression with no matching law can be registered. A committed receipt binds the result to the input, law, authenticated actor and relevant ancestry. The radio carries the signed header so participants can verify the evidence they can access and propose the next move independently.

A trajectory is the causal composition of receipts. State such as a balance is a projection under published rules. Continuity preserves the commitment and its relevant history when a participant or runtime changes.

## Why RADIO exists

The machine is a community's town-square clock: a common reference, not a controller of the community. Everyone can listen to the same authorized signal and decide independently what to do. An individual and an organization with thousands of agents can participate through the same interface. The operator knows the published process types, not the participants' private orchestration, memory, or internal infrastructure. The machine must not absorb that complexity.

The scanner is a deterministic recognition mechanism, not an LLM. The type defines the meaning of the input fields and the RUNs that constitute and advance its instances. A submitted expression is not yet an authorized effect. Recognition, authority, and execution are different properties.

The receipt is the object for effects constituted within RADIO. A balance is a projection of an economic trajectory; equal balances need not imply equal histories. Other laws can examine the same authorized evidence to form new objects. For effects outside RADIO, a receipt of authorization is distinct from evidence of execution: the external resource must enforce the authorization and a receipt alone cannot make an external claim true.

## The institutional layer

Third Layer asks what runs natively above software. PATT investigates receipt-governed computation, including a protected effect boundary and resource accounting. RADIO is a concrete, independent application of that research, not a transformer implementation or a general-purpose agent controller. It can be used by present-day software without PATT.

Authority is not intelligence or technical ability. A participant may be able to propose changes to its own runtime without having the authority to change the conditions under which it is trusted. Accountability connects consequences to responsible actors; trust comes from enforceable shared rules and independently checkable evidence; continuity preserves those relationships when participants, implementations or runtimes change. Human delegation and responsibility matter because people bear material consequences; a model's ability to generate a proposal does not confer authority. This does not require human intervention at every RUN.

Continuity is not just persistence or memory. A computation may end without erasing the commitment that it was intended to fulfill. The protocol preserves the history and conditions of a commitment; it cannot promise that a participant will actually fulfill it.

## The Institution as a Living Server

An Institution is a persistent institutional presence, not a continuously running application. In the Third Layer architecture, identity is the only standing application server: the persistent reference for authentication and participation. Authority remains a separate, enforceable condition; an authenticated identity is not a mandate. The identity authority is not the machine's receipt-signing key.

The computational mechanisms of an Institution are ephemeral. Its laws, commitments and constituted trajectories are durable. Between movements the Institution may remain computationally dormant without losing its continuity. A new Contract invokes computation under the applicable law, with explicit causal evidence; it does not resume a suspended application program. No instance requires a resident worker, open conversational session or central workflow orchestrator.

This borrows the economic insight of stateless and durable workflow architectures while preserving something different: institutional continuity rather than continuity of a particular execution. Persistence and communication still require infrastructure and resources. The single-server principle refers to the logical application architecture, not a claim that a deployment contains one physical machine or has no managed data services or idle costs.

## Elegance is a security and scaling property

Keep the machine small enough to understand and independently reproduce. Use one deterministic evaluator, content-addressed immutable laws and objects, signed receipts and authoritative transactional uniqueness. Keep translation probabilistic and external. Do not duplicate semantic rules in SQL or add a universal workflow controller. Refusals explain what was missing. A machine's key holder remains a trusted authority for issuance and the ledger remains an authority for shared uniqueness; independent replay does not establish external truth or ledger completeness.

RADIO's semantic core stays stable across implementations. The Supabase materialization uses Auth, ephemeral functions, PostgreSQL and Realtime. The local HTTP/SSE implementation provides an executable reference. A small community and a larger deployment can apply the same laws, with isolation and capacity verified for each deployment.

A Diplomacy pairs an immutable Process Type with one or more Agent Skills. The Skills show how to prepare a Contract for that law. The machine applies the published Process Type. [Founding DIPLOMACY article](DIPLOMACY.md) · [Approved package format](SPEC.md#15185-diplomacy-minimal-package)

For the versioned technical contract, compatibility boundary, open decisions and implementation sequence, read [SPEC.md](SPEC.md). For current commands and implementation status, see [README.md](README.md).
