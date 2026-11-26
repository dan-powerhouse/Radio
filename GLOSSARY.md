# RADIO — Glossary

*Third Layer / RADIO · Working vocabulary · 26 November 2026*

This glossary records the vocabulary used in RADIO and DIPLOMACY. The approved RADIO Protocol 1.0 defines technical behavior. [Specification](SPEC.md)

## LogLine

LogLine is the preferred convention for writing a Contract. Fields such as `who`, `did`, `this` and `with` help an author identify entities, describe an event or proposed action and give its context. A Skill can teach this convention for a particular law. The tuple remains free I-JSON, and the Process Type determines which fields matter.

## Core ontology

The six primary concepts distinguish institutional context, reusable definitions and concrete formation. They are conceptual distinctions, not a requirement for six database tables or runtime object types.

| Dimension | Term | Definition |
|---|---|---|
| Context | **Institution** | The living context of authority and participation within which one or more Diplomacies may be adopted. Its laws, commitments and constituted trajectories remain durable even when no institutional computation is active. An Institution is a persistent institutional presence (a living server in the Third Layer sense), not a resident application process, a Process Type, a trajectory or necessarily a deployment. |
| Definition | **Diplomacy** | A portable institutional artifact combining exactly one Process Type with one or more participant-facing Skills. It defines the rite and distributes the knowledge and law needed for participation. DIPLOMACY names the package format defined in SPEC §15.18.5 and inspired by Agent Skills. |
| Definition | **Process Type** | An immutable, content-addressed law defining a kind of trajectory: its recognition predicate, possible RUNs, conditions, causal dependencies and consequences. |
| Definition | **Skill** | Portable knowledge for action and participation. Skills may express different perspectives, responsibilities or strategies under a common law. They guide participants without conferring authority or altering the law. |
| Formation | **Contract** | The free I-JSON expression (the tuple in the current SPEC) submitted by a participant for consideration under a law. It expresses a proposed movement or intention; it is not, merely by submission, an accepted agreement, an authorization or a constituted effect. |
| Formation | **Process** | A concrete instance of a Process Type, constituted as a causal trajectory of receipts. The successful entry RUN identifies the instance by its receipt ID. No competing authoritative mutable workflow object is required. |

### Relationships

- An Institution may adopt multiple Diplomacies; the same Diplomacy may be adopted by multiple Institutions, subject to their respective authorization and publication boundaries.
- A Diplomacy contains one Process Type and one or more Skills. The package and the law have distinct identities.
- A Process Type may give rise to many independent Processes. A Process remains bound to its original law version.
- A participant uses knowledge from a Skill or other sources to formulate a Contract. The machine evaluates the Contract in its admitted context, under the applicable Process Type and RUN.
- A Contract does not necessarily constitute a Process. Only a successfully committed `ok` entry RUN forms an instance; subsequent admitted Contracts can contribute to its history through explicitly referenced movements.

**Institution establishes the context. Diplomacy establishes the rite. Process Type establishes the law. Skill teaches participation. Contract expresses intention. Process embodies history.**

### Example: academic formation

| Concept | Example |
|---|---|
| Institution | A university |
| Diplomacy | Academic Formation |
| Process Type | The law governing formation and certification |
| Skills | Guidance for students, teachers and evaluators |
| Contract | A submitted expression proposing an assessment |
| Process | A student's constituted academic trajectory |

The example is conceptual, not an additional domain model or executable law. The university may adopt other Diplomacies without changing the RADIO kernel.

## Computational foundations

| Term | Definition |
|---|---|
| **RADIO** | A universal protocol for the formation of verifiable trajectories. The machine recognizes, evaluates, constitutes and communicates institutional outcomes under published laws. |
| **Trajectory** | A causal composition of receipts. A Process has an instance-scoped history; citations can connect it to other trajectories without making every cited object a member of that instance. |
| **RUN** | A constitutive movement defined by a Process Type. A RUN definition is reusable across instances; an attempt evaluates that definition in an admitted context. In the current profile, a given RUN can successfully constitute a result at most once per instance. |
| **Receipt** | A signed, content-addressed object recording a movement or admitted attempt and binding its input, law, attribution, outcome and relevant ancestry. A successfully committed `ok` receipt constitutes the law-defined internal result. Other statuses record outcomes without constituting that successful result. |
| **Rite** | The shared conditions and possibilities of institutional participation. A rite does not prescribe a participant's strategy or automatically choose the next movement. Conceptual term, not an additional runtime object. |

## Participation and constitution

| Term | Definition |
|---|---|
| **Participant** | A human, agent or other authorized actor interacting with the machine. Its strategy, tools and private orchestration are external to RADIO. |
| **Intention** | What a participant wishes to accomplish or communicate. Interpretation and translation of intention occur outside the deterministic machine. |
| **Expression / Tuple** | The technical representation of a Contract: a free I-JSON value. Its field names have no implicit universal authority or routing meaning in the target profile. `tuple` remains the existing technical field name. |
| **Submission** | An independent request containing a Contract (`tuple`), submission nonce and optional explicit continuation context, admitted under authenticated identity. The request envelope is distinct from the Contract itself, an instance and a RUN result. |
| **Recognition** | Deterministic matching of an initial tuple against the laws in the authoritative immutable registry snapshot. Recognition selects a candidate law, not permission to act. |
| **Activation** | Satisfaction of the required input, causal and evidence conditions for the relevant RUN, subject to applicable authority. Recognition alone does not establish activation. |
| **Constitution** | The establishment of the law-defined internal result through a successfully committed `ok` receipt. Evaluation, signature and durable commit are distinct boundaries. |
| **Authority** | Legitimate permission to perform a particular operation under the applicable rules. Knowledge, technical capability, a claimed role, and authenticated identity are not sufficient by themselves. |
| **Mandate** | Delegated authority with defined scope or conditions. The approved delegation and revocation boundaries are described in SPEC §§15.18.1–2. |
| **Role** | A perspective or responsibility in an institution. A Skill can describe a role; possession of that Skill does not prove or grant it. Roles need not be intrinsic kernel entities. |
| **Continuation** | An independent submission referring explicitly to an existing instance, RUN and required predecessor receipts under its original law. It does not invoke initial recognition again. |
| **Outcome** | The result of an evaluation. The target statuses are `registered`, `not`, `doubt` and `ok`. A valid diplomatic refusal may itself be an `ok` result of a law-defined refusal movement; `not` is not a universal synonym for refusal. |
| **Registration** | The recording of a valid admitted expression without a successful activated result in the `registered` disposition. An unrecognized expression or unsuccessful entry does not create a process instance. Invalid admission and corrupt authoritative evidence are request failures, not registration outcomes. |

## Evidence, identity and continuity

| Term | Definition |
|---|---|
| **Registry** | The authoritative publication boundary for laws; its active set is represented by immutable, content-addressed snapshots. Retired laws remain available for historical verification. |
| **Law identity** | The SHA-256 content address of the canonical JSON Process Type. A published versioned ID cannot be rebound to different content. An amendment creates a new law ID and hash. |
| **Package identity** | The hash of a Diplomacy’s canonical manifest, which binds its component contents. The Process Type has its own law identity. See SPEC §15.18.5. |
| **Citation** | An explicit reference to a receipt required or permitted by the law. It must satisfy the applicable integrity, eligibility, access and consumption conditions. |
| **Parent** | A required causal predecessor RUN receipt of the same instance, as declared by `after`. A citation is not necessarily a parent. |
| **Projection** | A derived view of receipts under a rule or interpretation. It may represent state but is not a competing authoritative history. |
| **Continuity** | Preservation of a constituted commitment and its relevant evidence across participant, model or runtime replacement, subject to authorized access. Not a guarantee of fulfillment. |
| **Verification** | Checking authenticity, reproducibility of a decision and completeness of the required trajectory evidence under a declared trust model. These verdicts are distinct; they do not prove external truth, legal enforceability or global ledger completeness. |
| **Conformance** | Demonstrated agreement with the protocol's specified behavior using portable vectors, independent expected results, mechanism tests and CI gates. Passing an isolated implementation test is not proof of hosted conformance. |

## Architectural distinction

| Term | Definition |
|---|---|
| **Rigid core** | The semantic contracts, mechanisms, invariants, vectors, executable reference and conformance gates that preserve RADIO's identity across implementations. The first protocol freeze precedes native hosted materialization. |
| **Elastic substrate** | The infrastructure that materializes the protocol at a chosen scale. Supabase is the selected first hosted substrate; its services do not define the protocol's meaning. The physical enforcement boundary may change while preserving conformance. |

## Invariants of vocabulary

- Knowledge is not authority; recognition is not activation; evaluation is not durable constitution.
- Institutional context does not itself confer authority, imply shared identity or establish cross-institution access. Institution is not yet a new protocol object or tenancy model.
- Contract names the proposed expression, not an already constituted agreement. A Receipt attests its outcome under the applicable law; legal enforceability and external fulfillment are separate questions.
- A Diplomacy contains a Process Type and participant-facing Skills. A Process is an instance trajectory, not the package or another copy of the law.
- The law defines possible valid movements; participants choose which movements to propose. No implicit orchestration follows a receipt.
- The current finite acyclic RUN profile is retained. Open-ended negotiation, mutual exclusion of different terminal RUNs, and other domain-specific conditions must be expressed by an approved law or a separately approved protocol change, not inferred from a diagram or a Skill.
- Package identity and law identity are distinct; changing guidance need not change the law or rewrite a constituted history.

## Source and status

- [RADIO specification](SPEC.md), especially §§3, 15.1–15.11 and 15.18.
- [RADIO vision](VISION.md).
- [Introducing DIPLOMACY](DIPLOMACY.md), founding article of 26 November 2026.
