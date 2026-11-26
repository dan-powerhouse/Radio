# RADIO — Vision

RADIO is a universal protocol for the formation of verifiable trajectories. It is an application of Third Layer's research into what runs natively above software. The PATT architecture is a potential participant and consumer of RADIO's institutional state, not a dependency of the machine.

## Target contract

A person or agent expresses an intention; a translator (human or LLM, via MAP where applicable) supplies a free JSON LogLine over MCP or API. Supabase OAuth authenticates the caller. A deterministic scanner recognizes applicable published process types. A process type is immutable JSON defining its own recognition conditions, interpretation of fields and one or more RUNs. The first RUN can instantiate a process; an unrecognized expression is registered. Each RUN produces a signed receipt. The receipt is the constituted digital object, not a separate log of an object. It commits to the input, law, identity and relevant ancestry. The public signed header is emitted on the radio; private evidence remains protected. A participant listens, decides independently and submits a new input. No common workflow controller is required.

A trajectory is the causal composition of receipts; state (such as a balance) is a projection under published rules. Continuity means a commitment and its relevant history survive replacement of the participant or runtime. It is not a guarantee that anyone will fulfill a commitment. Authority, accountability, trust and continuity are complementary. Authenticated accounts and the actual scope of human delegation must not be inferred from free tuple text.

One logical machine provides a common reference for a community, like its town-square clock. Participants' private infrastructure is outside its scope. The hosted path is Supabase Auth, ephemeral functions, Postgres/CAS and Realtime WebSocket. MCP/API calls are independent. The local HTTP/SSE implementation remains the reference, not a production dependency. The same code base should support a small community and larger hosted deployments; isolation, consumption scope and scale limits need explicit contracts, not implicit cross-community access.

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

**Persistent identity. Ephemeral computation. Continuous institutions.**

## Elegance is a security and scaling property

Keep the machine small enough to understand and independently reproduce. Use one deterministic evaluator, content-addressed immutable laws and objects, signed receipts and authoritative transactional uniqueness. Keep translation probabilistic and external. Do not duplicate semantic rules in SQL or add a universal workflow controller. Refusals explain what was missing. A machine's key holder remains a trusted authority for issuance and the ledger remains an authority for shared uniqueness; independent replay does not establish external truth or ledger completeness.

RADIO has a rigid semantic core and an elastic computational substrate. The contracts, specified mechanisms, invariants and conformance evidence preserve the machine's identity; CI gates protect their continuity as implementations change. The substrate is chosen for the intended scale: Supabase is our native hosted materialization, not a requirement of the protocol. A local implementation or a different infrastructure may conform without sharing its physical design. Logical unity does not require a single physical worker or global write lock. Isolation, authorization and scalability guarantees must be specified and measured rather than assumed.

[DIPLOMACY](DIPLOMACY.md) combines one immutable machine-facing Process Type with one or more participant-facing Agent Skills. Skills teach participation; the law determines constitution. Instructions must not become the authority for machine recognition or execution. The exact packaging contract remains open.

For the versioned technical contract, compatibility boundary, open decisions and implementation sequence, read [SPEC.md](SPEC.md). For current commands and implementation status, see [README.md](README.md).
