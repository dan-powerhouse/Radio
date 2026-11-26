# Introducing DIPLOMACY

*An open format for institutional trajectories*

**Third Layer / RADIO · Founding proposal · 26 November 2026**

As agents become better at working independently, a different problem comes into focus: how can independent intelligences work together when they have different interests, responsibilities and authority?

An agent may know how to prepare an offer, evaluate a proposal or negotiate a concession. But knowing how to act does not establish whether it can represent someone, make a commitment on their behalf or constitute an outcome that another participant can rely on. Nor should a commitment disappear when an agent is replaced or a conversation ends.

Agent Skills, introduced by Anthropic in October 2025, made specialized operational knowledge portable. DIPLOMACY takes that idea into a different domain: institutional participation. Rather than packaging the knowledge needed for a single capability alone, it brings together the knowledge and shared rules that make a particular kind of relationship possible.

**A Skill prepares an intelligence to act. A Diplomacy prepares independent intelligences to participate under a common law.**

DIPLOMACY is an independent proposal, openly inspired by the Agent Skills standard. It complements Skills and the Model Context Protocol (MCP); it does not replace them, and it is not an Anthropic standard or an extension approved by the Agent Skills project.

## The anatomy of a Diplomacy

A Diplomacy is a portable package, distributed as `DIPLOMACY.zip`, containing one Process Type and one or more participant-facing Skills. The Process Type defines the characteristics of a particular kind of trajectory. The Skills help humans and agents understand the institution and how to participate in it.

For example, a package for negotiating a service commitment could contain:

```text
DIPLOMACY.zip
  diplomacy.json
  process-type.json
  skills/
    proposer/
      SKILL.md
    counterparty/
      SKILL.md
    representative/
      SKILL.md
      references/
        mandate-guide.md
```

The proposed manifest, `diplomacy.json`, identifies the artifact and its components. `process-type.json` contains the deterministic law. Each Skill follows the existing Agent Skills conventions rather than a newly invented instruction language. References can carry domain-specific context when it is useful.

These filenames and the archive layout describe the proposed minimal profile; the exact manifest schema and validation rules are still to be specified. A package is not an instance, and installing it is not an act of institutional authority.

### Plural knowledge, common law

A negotiation has more than one perspective. The proposer may seek favorable terms; the counterparty may prioritize risk; a representative may need to remain within a delegated mandate. Each can use a different Skill without requiring a different law.

A Skill can explain which inputs are meaningful, how to interpret a refusal, what evidence to consult, or how to formulate a counterproposal. It cannot grant the authority to act, override a condition in the Process Type or make a receipt valid by describing it as such.

The common law need not embody everyone's interests or guarantee a fair outcome. It establishes a shared reference for validity. Participants retain their freedom to disagree, withhold consent, seek better terms or choose not to participate.

## From a type of trajectory to a process

The most important distinction in DIPLOMACY is between a definition and its history.

| Concept | Meaning |
|---|---|
| Skill | Knowledge for participation. |
| Process Type | The law defining a kind of trajectory. |
| Diplomacy | The artifact combining that law with participant-facing knowledge. |
| Process | A concrete trajectory constituted under a Process Type. |
| RUN | A constitutive movement defined by the law. |
| Receipt | A signed, verifiable object recording the outcome of a movement or admitted attempt. |

A Process Type can give rise to many independent processes. Each process is its own causal history of receipts, not another copy of the law or a mutable workflow record that competes with that history. A successful entry RUN constitutes the instance; its receipt identifies it. Later movements refer to that instance and its relevant predecessors. An admitted expression that cannot be recognized or activated can still be registered, without constituting a successful effect or a new instance.

The same law may permit different histories. Some reach an agreement. Some end in a valid refusal. Others remain open. A refusal of a proposed agreement can be a successful institutional act in its own right if the law defines it that way; it is distinct from a technical failure or an unsuccessful activation.

The first RADIO profile uses finite acyclic RUN definitions, with at most one successful result per RUN per instance. A more extensive negotiation can be explored through the composition of linked trajectories rather than introducing a general-purpose workflow engine or silently changing these guarantees.

## A Diplomacy in action

Consider two organizations negotiating a service commitment. A representative of the first prepares an offer. The other may accept the offered terms, decline them, or propose different terms if the law permits that movement. The parties can consult their own instructions, internal policies and evidence. They need not disclose their full negotiating strategies to the machine or to each other.

The following is a conceptual example of possible movements, not a new RUN schema or an implemented integration:

| Movement | Institutional question |
|---|---|
| Propose | Is the caller permitted to make this proposal? Which exact terms are being offered? |
| Counter | Does the new proposal refer to the offer it would replace or amend? |
| Concede | Which conditions make the concession applicable? |
| Accept | Does the actor have the mandate to accept these exact terms and their referenced history? |
| Decline | Is the refusal a permitted movement, and what commitments remain unaffected? |

A participant translates an intention into a free JSON expression and submits it through an independent request. RADIO authenticates the caller at its admission boundary, recognizes the applicable published law for an initial submission, and evaluates the proposed RUN against its conditions. Continuations use explicit causal references and the original law, rather than a new recognition decision.

When a movement succeeds, the machine constitutes a signed receipt. When activation is unmet or evaluation yields a refusal or doubt, the recorded result preserves that distinction. Only successfully committed receipts are emitted to listeners. Each participant can verify the available evidence and decide whether to respond. No central agent chooses the next move.

The result is not a transcript summarized into a contract. It is a trajectory of explicitly constituted objects, with a law, attribution, consequences and causal relations that can be independently checked within the declared trust model.

## Context that survives the context window

Agent Skills demonstrated the value of revealing knowledge progressively: expose a small description first, then read the instructions and supporting materials relevant to the task. DIPLOMACY adopts that principle for institutional participation.

A participant should be able to discover the purpose of a Diplomacy, identify the applicable Skill, inspect the relevant parts of the law and retrieve the authorized evidence needed for its next movement. It does not need to load every Skill, every reference or the entire history into a prompt.

A mandate, a prior offer and an accepted condition can be represented by structured references to exact objects. They remain identifiable when a participant's context window is cleared. A replacement participant can recover authorized history and continue under the same law, subject to its own valid authority.

The machine evaluates the complete evidence required by the formal rules. Selective loading for participants is an efficiency principle, not permission to omit required evidence from verification. The current RADIO design also separates public signed headers from protected detail: a reference is not permission to retrieve private information.

## Identity, integrity and evolution

Knowledge and law evolve at different rates. The identity of a Process Type is derived from its canonical JSON content; changes to constitutive conditions require a different law identity. Existing trajectories stay bound to the law under which they were constituted, even after retirement or amendment.

A revision of a Skill may improve how participants use the same law. This should create a different package revision without necessarily changing the Process Type's identity. The proposed package identity would commit to its component contents and their association, independently of ZIP compression or archive ordering. Exact canonical manifest and digest rules remain a design decision for the format specification.

This separation preserves continuity across revisions of guidance, model replacement and infrastructure change. It also makes it possible to audit the exact guidance an artifact distributed without making the guidance itself a source of authority.

## Developing and evaluating a Diplomacy

Start with the relationship, not with the agent. Identify what the participants can constitute together, which distinctions matter, and what must remain true regardless of their implementation.

1. **Describe the rite.** Establish the purpose, possible movements, legitimate participants and meaningful outcomes. Do not prescribe a strategy for every participant.
2. **Write the law.** Express recognition, conditions, RUNs, consequences and causal dependencies using the existing Process Type contract. Keep domain-specific interpretation outside the machine.
3. **Teach participation.** Write one or more focused Skills. Use existing Agent Skills conventions and separate optional reference material from core instructions.
4. **Specify expected histories.** Create independent conformance examples before implementing mechanisms: a valid entry, a valid refusal, an unauthorized attempt, a repeated request, distinct instances and a continuation under an older law.
5. **Try to break the boundary.** Verify that changed instructions, fabricated authority, altered evidence or competing submissions cannot produce an outcome the law does not permit. Test replacement of a participant and offline replay of the evidence.

Skills may improve a participant's ability to propose good movements. Conformance establishes whether the machine applies the law correctly. These are separate evaluation problems. A successful language-model interaction is not a substitute for deterministic expected results or transactional tests.

### Security and authority

DIPLOMACY inherits the risks of distributing agent instructions and potentially executable resources. A participant's runtime must apply its own trust, sandbox and permission policies. A package must not confer permissions merely by containing a role description or an `allowed-tools` declaration. The RADIO machine does not execute Skill scripts, interpret Markdown as law or trust claimed identities inside free expressions.

The proposed package validator must reject malformed, unsafe or ambiguous archive contents and verify component integrity before publication. Provenance and trust in the publisher are distinct from a correct digest. Receipt verification establishes authenticity and, with sufficient trusted evidence, reproducibility of the decision; it does not establish external truth, actual fulfillment, legal enforceability or global ledger completeness.

## A small format for a larger possibility

The first version of DIPLOMACY should remain deliberately small: a portable package, one canonical Process Type, one or more Skills, explicit component identity and validation, examples and a conformance corpus. Exact packaging rules must be reviewed and frozen before the first normative release. A negotiation engine, marketplace, private participant memory, universal orchestration system, new Skill language and reputation system are outside its scope.

The format contract and its conformance evidence belong to RADIO's rigid core. Storage, distribution and discovery infrastructure can be materialized later in the elastic substrate. Supabase is the chosen hosted materialization for RADIO; it does not define the meaning of a Diplomacy. The format should be comprehensible and verifiable independently of that provider.

Diplomacy offers a useful way to think beyond agents that simply complete tasks. Participation can involve representation, consent, negotiation, compromise, disagreement and the preservation of a relationship over time. The participants own that intelligence and strategy. The protocol owns the integrity of the institutional record.

**The artifact defines the rite. The participants produce the history. The protocol preserves its integrity.**

SKILL — Knowledge for action.  
DIPLOMACY — Knowledge and law for participation.  
RADIO — Formation of verifiable trajectories.

*Plural knowledge. Common law. Verifiable history.*

---

## Editorial and technical status

This founding article records the proposed direction agreed in discussion; it is not a final wire specification, a release announcement of shipped software or a claim of demonstrated DIPLOMACY interoperability. The exact manifest fields, package digest, archive safety profile, law-to-Skill binding and conformance rules remain to be specified. RADIO's existing Process Type and recognition implementation is in review; target RUN/receipt and trajectory implementation remains pending. The existing finite acyclic RUN profile is not changed by this article. No new infrastructure or external service is required by the proposal.

### References and inspiration

- Anthropic, [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills), 16 October 2025. Editorial and conceptual inspiration: portable expertise, anatomy, selective context loading, evaluation and security.
- Anthropic, [Introducing Agent Skills](https://www.anthropic.com/news/skills), 16 October 2025. Original product introduction.
- [Agent Skills specification](https://agentskills.io/specification), consulted 26 November 2026. The source of the embedded Skill conventions; DIPLOMACY is a separate proposed format.
- RADIO, [VISION.md](https://github.com/dan-powerhouse/Radio/blob/beeb0d01ef16e05554cab1670fbbfffe6252be0e/VISION.md) and [SPEC.md](https://github.com/dan-powerhouse/Radio/blob/beeb0d01ef16e05554cab1670fbbfffe6252be0e/SPEC.md), §§15.1–15.11; current reviewed implementation checkpoint, not a frozen release.
