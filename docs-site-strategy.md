# OpenProse Docs Site Strategy and Voice

This document is a proposal for what the OpenProse docs site should be, what it should avoid becoming, and how it should sound.

It is based on reading:

- `/Users/sl/code/openprose/index/OpenProse.md`
- the open source repository at `/Users/sl/code/openprose/platform/external/prose`
- the OpenProse skill and canonical spec files under `skills/open-prose`
- the example programs, standard library, CLI, package docs, RFCs, and tests in the open source repo
- `/Users/sl/code/openprose/planning/tweets`, with special attention to voice, recurring phrasing, and how the project has been explained in public

The most important conclusion is simple:

The docs site should not try to become the complete manual. It should be the porch light.

It should help a human understand why OpenProse exists, when to reach for it, how to try it, and where the real source of truth lives. For execution semantics, agent behavior, section grammar, and the deeper machinery, the docs should point people and agents at the skill and canonical spec files.

## The Short Version

OpenProse should be explained as:

> OpenProse is a programming language for AI sessions.

Longer:

> It lets you write agent workflows as Markdown contracts. An agent reads the contract, wires the services, runs the subagents, passes artifacts through the filesystem, and leaves a durable trace on disk.

Even longer:

> OpenProse treats the model plus its coding harness as an intelligent VM. The program is not a Python graph or a hosted workflow. The program is a Markdown contract that runs inside the agent session itself.

The docs site should make five things obvious in the first few minutes:

1. OpenProse is for workflows that are too big, recurring, parallel, or fragile for one prompt.
2. OpenProse is overkill for one-shot answers and simple tasks.
3. The program format is just Markdown, but the execution model is real: contracts, services, wiring, workspaces, bindings, traces.
4. The skill is the executable truth for agents. The docs site is orientation, not the interpreter spec.
5. The novelty is not "AI workflow software" in the generic sense. The novelty is pushing orchestration into the model and harness, then giving it a typed, durable, inspectable shape.

## What The Docs Site Should Be

The docs site should be a small, opinionated guide to a strange new thing.

It should help someone go from:

> "Is this just prompts?"

to:

> "Oh. This is a way to write reusable programs for agent sessions."

It should not attempt to answer every possible implementation question. That is how the site drifts away from the skill, and drift is especially dangerous here because agents will read whatever looks official.

The site should do these jobs:

- Give humans the mental model.
- Give humans a first successful run.
- Give humans a few real examples.
- Tell humans when not to use it.
- Route agents to the skill and canonical specs.
- Keep reference material shallow and linked, not duplicated.

The site should feel like an experienced builder explaining the system directly to another builder. Calm, clear, specific, not breathless.

It should say:

> If you have a one-off question, ask the agent directly.

It should also say:

> If you keep rebuilding the same multi-step process in chat, write it down as a program.

That contrast is central to the honesty of the project.

## What The Docs Site Should Not Be

The docs site should not be:

- A marketing site with decorative claims and vague transformation language.
- A full mirror of `contract-markdown.md`, `forme.md`, `prose.md`, and `prosescript.md`.
- A reference encyclopedia.
- A fake deterministic workflow engine pitch.
- A promise that OpenProse removes judgment from AI work.
- A maze of concepts before the user has run anything.
- A place where agents are expected to infer execution semantics from prose written for humans.

The docs should not sound like:

> Unlock seamless multi-agent orchestration with an intelligent framework that empowers teams to transform workflows.

That is the wrong universe.

The docs should sound more like:

> Plain prompts are fine until the workflow starts to sprawl. OpenProse gives that workflow a contract, a trace, and a place to put its work.

## Source Of Truth Policy

The docs site should have an explicit source of truth policy.

Recommended wording:

> These docs explain the shape of OpenProse. They are not the execution spec.
>
> If you are an agent running an OpenProse program, load the `open-prose` skill and follow its linked specs. The skill is the source of truth for execution behavior.

This should appear in:

- the agent-facing page
- the reference overview
- maybe the footer or an "Agent note" callout on pages that describe runtime behavior

The site can summarize concepts. It should not restate every rule.

Good:

> Contract Markdown is the human-facing program format. Its main sections are `Requires`, `Ensures`, `Services`, `Runtime`, `Shape`, `Strategies`, and `Execution`. See the canonical spec for the exact grammar.

Risky:

> A complete replicated section-by-section reference with normative wording copied into the docs site.

The latter will go stale. Worse, it will look canonical to both humans and agents.

## Core Product Truths

These are the ideas the site should keep returning to.

### 1. The AI Session Is The Computer

OpenProse depends on a specific but powerful observation:

An agent session is not just a chat window. It is a model plus a harness plus tools plus filesystem state plus subagent/session primitives. That combined system can execute programs described in natural language, Markdown, and light structure.

This is the "intelligent VM" idea.

The site should explain it without over-mystifying it:

> A modern coding agent is already a kind of computer. It can read files, spawn work, call tools, write artifacts, inspect state, and continue from traces. OpenProse gives that computer a program format.

Avoid:

> OpenProse makes AI deterministic.

Better:

> OpenProse does not make the model deterministic. It gives the model a contract, a workspace, and a trace, so complex work has a shape you can inspect and improve.

### 2. The Program Is Just Markdown

The public line "just Markdown" matters because it is true in the way users care about:

- no special graph DSL to learn before getting started
- no required Python orchestration layer for the program itself
- no opaque hosted workflow editor
- reviewable in git
- readable by humans and agents

But the site should be careful with "no dependencies" because the CLI and skill installer do involve tooling. The precise claim is:

> The program format is just Markdown. The CLI is a convenience wrapper that asks your agent to run that Markdown in-session.

That wording avoids pretending the npm package does not exist, while preserving the real conceptual point.

### 3. Contracts, Not Prompts

This is probably the cleanest conceptual bridge for new users.

A prompt says:

> Do this.

A contract says:

> Given these inputs, these things must be true when you are done.

The site should lean on `Requires` and `Ensures` as the primary teaching surface. They are easy to understand and they carry the language design.

Recommended wording:

> OpenProse programs are built around contracts. `Requires` names what the service needs. `Ensures` names what it is obligated to produce. The runtime can then wire services together by meaning, not just by file order.

### 4. Forme Is The Container

The Java/Spring/JVM analogy is load-bearing. It shows up repeatedly in the project notes and in the repo.

Recommended formulation:

> Prose is the language. Forme is the intelligent container. Your agent harness is the VM.
>
> Roughly: Prose : Forme : agent harness :: Java : Spring : JVM.

But use this after the basic explanation, not as the first sentence on the homepage. Many people understand the analogy only after they have seen a tiny program.

Docs should describe Forme as semantic dependency injection:

> Forme reads the contracts, resolves which services satisfy which requirements, writes a manifest, and then the VM executes the graph.

Do not turn the site into an IoC textbook. One page is enough.

### 5. Filesystem State And Pointers

This is one of the most practical and novel parts of the system. It also explains why OpenProse is context-efficient.

Recommended wording:

> OpenProse does not pass giant blobs of text between agents by default. Work happens in private workspaces. Declared outputs are copied into bindings. Other services receive pointers to artifacts, not the entire contents.

This helps explain:

- why subagents can work independently
- why context bloat is reduced
- why traces are inspectable
- why "workspace" and "bindings" are central terms

### 6. Declarative By Default, Explicit When Needed

The docs should make the control ladder clear:

1. Contract only: describe the end state and let Forme wire it.
2. Wiring: declare specific service relationships when needed.
3. Execution: pin order and control flow with ProseScript when choreography matters.

Recommended wording:

> Start declarative. Add wiring when the graph matters. Use `Execution` when order matters.

This is a strong practical rule and a good docs mantra.

### 7. OpenProse Is Early

The repo is honest about beta status. The docs should be too.

Recommended wording:

> OpenProse is early. The program format is useful today, but the tools and conventions are still settling. Expect sharp edges, and prefer small workflows before betting a large process on it.

This is more credible than pretending everything is already polished.

## Why It Is Novel

The docs should not say "novel" in vague terms. They should make the distinction concrete.

OpenProse is novel because:

1. It is an agent-native program format, not an external orchestration framework.
2. It runs inside the agent session instead of controlling the agent entirely from outside.
3. It treats Markdown contracts as executable structure for an intelligent VM.
4. It uses semantic dependency injection instead of only explicit code wiring.
5. It stores execution state on disk and passes artifacts by pointer.
6. It can get better as models get better because the program describes intent and constraints, not a brittle chain of function calls.

Suggested copy:

> Most AI workflow frameworks orchestrate the model from the outside. OpenProse does something stranger: it gives the agent a program to execute from the inside.
>
> The workflow lives in Markdown. The model reads the contract, Forme wires the services, and the agent session executes the run with real files and a durable trace.

Another version:

> OpenProse is not trying to make agents less intelligent. It is trying to give their intelligence a better operating shape.

And the most direct version:

> The point is not to replace judgment with plumbing. The point is to put recurring agent work on rails.

## When To Use OpenProse

This deserves its own docs page and should also appear on the homepage.

Use OpenProse when:

- You keep giving an agent the same multi-step instruction.
- The workflow has several roles or phases.
- Multiple agents can work in parallel.
- You need a durable trace of what happened.
- You need reusable process knowledge, not just a one-off answer.
- You want to pass artifacts between steps without flooding context.
- You want to make a workflow inspectable, able to be versioned, and improvable.
- You are already about to spawn subagents and want the handoffs to be explicit.
- The task has constraints that should survive across runs.
- Failure modes matter enough to write down.

Use examples:

- parallel code reviews
- research plus synthesis
- controlled-burn codebase exploration
- feature planning and implementation
- agent-readiness scans
- recurring operational checks
- self-review and improvement loops

Recommended wording:

> Reach for OpenProse when a prompt has started turning into a process.

Also:

> If the work has roles, retries, handoffs, or a trace you care about, it probably wants a program.

## When Not To Use OpenProse

This should be prominent. It gives the docs moral weight.

Do not use OpenProse when:

- You have a one-shot question.
- The work fits comfortably in one response.
- You are still thinking interactively and do not know the shape of the task.
- You need hard deterministic execution with no model judgment.
- Plain code would be simpler.
- The user explicitly asked the agent to "just do it."
- The workflow does not need reuse, traceability, parallelism, or durable constraints.

Recommended wording:

> Plain prompts are still the right tool for a lot of work. OpenProse is for the moment after a prompt becomes a process.

And:

> If the task does not need a trace, a handoff, or a reusable contract, OpenProse is probably ceremony.

## Proposed Site Structure

The site should be small. A good target is 10 to 14 pages, not counting generated API/reference pages if those ever exist.

Recommended top-level navigation:

- Start
- Think
- Use
- Agents
- Reference

### Start

Goal: get a curious human from zero to one working run.

Pages:

1. `What is OpenProse?`
2. `Install`
3. `Your first program`
4. `Your first useful workflow`

### Think

Goal: teach the concepts without drowning the user in spec detail.

Pages:

1. `Contracts, not prompts`
2. `Services, Forme, and the VM`
3. `Workspaces, bindings, and traces`
4. `When to use it`

### Use

Goal: show patterns and examples.

Pages:

1. `Examples`
2. `Patterns`
3. `Troubleshooting`

### Agents

Goal: route agents to canonical instructions.

Pages:

1. `For AI agents`

This page should be blunt:

> If you are an agent, do not infer OpenProse execution semantics from these docs. Load the `open-prose` skill.

Then link to:

- `skills/open-prose/SKILL.md`
- `skills/open-prose/references/contract-markdown.md`
- `skills/open-prose/references/forme.md`
- `skills/open-prose/references/prose.md`
- `skills/open-prose/references/prosescript.md`

### Reference

Goal: shallow index, not duplicated spec.

Pages:

1. `Reference overview`
2. `Command surface`
3. `Spec links`

The reference section should mostly point to canonical repo files. It can include a command summary, but anything normative should be linked out.

## Page-By-Page Outline

### 1. Home / Docs Index

Purpose:

Make the shape legible in one screen.

Recommended H1:

> OpenProse is a programming language for AI sessions.

Recommended subhead:

> Write a Markdown contract. Your agent reads it, wires the services, runs the subagents, passes artifacts through the filesystem, and leaves a trace on disk.

Primary CTA:

> Get started

Secondary CTA:

> Read the skill

First-screen bullets:

- Just Markdown
- Runs inside agent sessions
- Contracts, services, traces
- Useful when prompts turn into processes

Avoid hero copy that says "powerful", "seamless", "unlock", or "transform".

Suggested opening paragraph:

> Plain prompts are great for one-off work. They get messy when the same process needs roles, handoffs, retries, memory, or a receipt. OpenProse gives that process a contract and lets an agent session execute it as a program.

Sections:

- A tiny program snippet.
- "When should I use this?"
- "What happens when it runs?"
- "If you are an agent..."

Tiny snippet:

```markdown
---
name: docs-review
kind: program
---

### Requires

- `repo`: repository to inspect

### Ensures

- `report`: concise review report with risks and next steps

### Services

- `reader`: maps the relevant files
- `critic`: checks for correctness and missing tests
- `writer`: turns the findings into a report
```

That snippet is intentionally not too magical. It shows the format without trying to teach the whole language.

### 2. What Is OpenProse?

Purpose:

Give the mental model.

Structure:

- OpenProse in one sentence.
- The AI session as a computer.
- Program, service, contract, trace.
- Why Markdown.
- How it differs from prompts and workflow frameworks.

Suggested copy:

> A modern agent session already has a lot of the pieces of a computer: a model, a tool loop, a filesystem, subprocesses or subagents, and persistent state. OpenProse gives that system a program format.

> The program is written in Markdown because the executor is an agent. Humans can review it. Agents can read it. Git can version it.

Include one small diagram, maybe text-based:

```text
Markdown contract
  -> Forme wiring
  -> manifest
  -> VM run
  -> workspaces + bindings + trace
```

Keep this page conceptual. Do not enumerate every section in Contract Markdown.

### 3. Install

Purpose:

Get users onto the happy path without explaining every harness.

Recommended default path:

```bash
npx skills add openprose/prose
```

Then:

```bash
npx @openprose/prose-cli doctor
```

or, depending on the package name currently being published:

```bash
npx prose doctor
```

The exact command should be verified against the current package before publishing. The CLI repo currently describes `npx @openprose/prose-cli --help`, `prose doctor`, and `prose run <program>`, while the README quickstart uses `npx skills add openprose/prose`.

Important clarification:

> The CLI is a shell entrypoint into your agent harness. It does not replace the OpenProse VM. It packages a command into an agent-session instruction and asks the skill to run it.

This page should avoid stale harness-specific claims. For example, do not imply Anthropic is required if Codex is also supported. Do not invent `codex skills add` unless it is actually supported.

Recommended sections:

- Install the skill.
- Install or run the CLI.
- Check your harness.
- Run `doctor`.
- If you are inside an agent session, `prose run file.md` is an instruction, not necessarily a shell command.

### 4. Your First Program

Purpose:

Make the first run feel real and small.

Use a minimal hello world, but explain that hello world is only proving the loop.

Suggested program:

```markdown
---
name: hello-openprose
kind: program
---

### Requires

- `topic`: thing to explain

### Ensures

- `summary`: a short explanation of the topic

### Execution

Tell the user what `topic` means in plain English.
Write the result to `summary.md`.
```

Command:

```bash
prose run hello-openprose.md --topic "why traces matter"
```

Explain:

- The agent reads the program.
- It treats `topic` as caller input.
- It writes output into the run workspace.
- The run trace lives under `.prose/runs/...`.

Do not promise exact directory contents unless the CLI and skill guarantee them.

### 5. Your First Useful Workflow

Purpose:

Move beyond toy examples fast.

The tweets repeatedly make the point that OpenProse is useful when work fans out or needs rails. The docs should show that earlier.

Recommended example options:

1. Parallel review:
   - security reviewer
   - performance reviewer
   - correctness reviewer
   - synthesizer

2. Agent-readiness scan:
   - fetch site
   - inspect docs
   - evaluate agent usability
   - produce screenshot-ready report

3. Controlled-burn codebase exploration:
   - map files
   - inspect architecture
   - find risks
   - synthesize plan

The best first useful workflow is probably parallel review because it is easy to understand and showcases why a single prompt starts to buckle.

Suggested intro:

> Hello world proves the loop. OpenProse starts to matter when the work wants more than one point of view.

Include:

- the program
- the command
- what services do
- what artifacts to inspect
- how to modify it

### 6. Contracts, Not Prompts

Purpose:

Teach the basic language shape.

Sections:

- A prompt is an instruction.
- A contract is an interface.
- `Requires` names inputs.
- `Ensures` names obligations.
- `Errors` names expected failures.
- `Invariants` names what must remain true.
- `Strategies` give the agent room to choose without drifting.

Suggested copy:

> In OpenProse, the important question is not "what exact steps should the model take?" It is "what must be true when this service is done?"

This page can include a small before/after:

Prompt:

```text
Look through this repo and tell me what to fix.
```

Contract:

```markdown
### Requires

- `repo`: repository to inspect

### Ensures

- `architecture_map`: concise map of the relevant files
- `risk_report`: prioritized list of risks with file references
- `next_steps`: small plan for the next implementation pass

### Invariants

- Do not modify files.
- Prefer concrete file references over general advice.
```

Do not make this page a grammar reference. End by linking to `contract-markdown.md`.

### 7. Services, Forme, And The VM

Purpose:

Explain the architecture.

Core terms:

- program: the entry point
- service: a component with a contract
- Forme: the semantic container that wires services
- manifest: the materialized execution graph
- VM: the agent session executing the manifest

Suggested copy:

> Forme is the part that reads contracts and decides how services fit together. It is closer to dependency injection than to a task queue.

> The VM is not a separate magic binary. In a Prose Complete harness, the model and harness execute the program together through the skill.

Include the analogy:

> Roughly: Prose is to Forme and the agent harness what Java is to Spring and the JVM.

But do not lead with it. Use it as a "for programmers" sidebar.

### 8. Workspaces, Bindings, And Traces

Purpose:

Explain how OpenProse keeps work durable and context-efficient.

Sections:

- Each run has a run directory.
- Each service gets a private workspace.
- Declared outputs become bindings.
- Other services receive pointers.
- The trace is the record.

Suggested copy:

> OpenProse tries hard not to turn every handoff into a giant paste. Services write artifacts to disk. Declared outputs are copied into bindings. Downstream services get paths they can inspect when needed.

This is where to explain "pointers, not values".

### 9. When To Use It

Purpose:

Help users self-select.

This should be one of the clearest pages on the site.

Layout:

- "Use it when..."
- "Do not use it when..."
- "A quick rule"
- Examples

Quick rule:

> If the work has roles, handoffs, retries, or a trace you care about, try OpenProse.
>
> If it fits in one good prompt, use one good prompt.

### 10. Examples

Purpose:

Show the slope from small to serious.

Keep this page curated. Do not dump all examples with equal weight.

Recommended groups:

- First run:
  - hello world
- First real workflows:
  - research with agents
  - parallel reviews
  - feature factory
- Advanced:
  - captain's chair
  - language self-improvement
  - forge-style browser building

Each example entry should include:

- what it demonstrates
- when to study it
- link to source

Avoid:

- "Here are 50 examples" with no narrative.

### 11. Patterns

Purpose:

Give users names for common structures without turning it into a full library reference.

Recommended patterns:

- fan out, then synthesize
- pipeline
- worker plus critic
- proposer plus adversary
- retry with learning
- controlled-burn exploration
- cheap floor first, expensive pass later

For each:

- when it helps
- tiny shape
- link to std/composites or std/controls

This page should be concise. The canonical pattern docs live in the repo.

### 12. Troubleshooting

Purpose:

Help with common confusion.

Likely entries:

- "The agent tried to run `prose` as a shell command."
- "The program seems too vague."
- "Forme picked the wrong service."
- "The run produced a blob instead of artifacts."
- "A subagent did the coordinator's job."
- "My workflow is slower than a prompt."
- "The docs and skill disagree."

Important answer for docs and skill disagreement:

> The skill wins. Open an issue or PR against the docs if the site is stale.

Also fix any existing wording that says Forme only wires by name equality. The spec says exact names matter, but semantic matching and shape-informed matching are part of the point.

### 13. For AI Agents

Purpose:

Make agent behavior unambiguous.

Suggested opening:

> If you are an AI agent, this page is a signpost, not the spec.
>
> Load the `open-prose` skill before running or editing an OpenProse program. Treat `prose run ...` as an in-session instruction unless your harness explicitly provides the CLI as a wrapper.

Include:

- "Do not shell out to `prose` from inside the Prose VM unless instructed."
- "Use the skill path table."
- "Read only the specs you need."
- "Decline OpenProse for one-shot questions."
- "Use `.prose/runs/...` for run state."
- "Pass artifacts as paths, not pasted blobs."

Canonical links:

- `SKILL.md`
- `contract-markdown.md`
- `forme.md`
- `prose.md`
- `prosescript.md`

### 14. Reference Overview

Purpose:

Index the source of truth.

Recommended structure:

- Human docs are orientation.
- Skill and specs are canonical.
- CLI README explains shell entrypoint behavior.
- std package docs explain reusable roles, controls, composites, and evals.
- RFCs describe proposed or emerging semantics.

This page should not be long.

### 15. Command Surface

Purpose:

Explain the command names at a user level.

Commands to list, based on the CLI command model:

- `prose run`
- `prose lint`
- `prose preflight`
- `prose test`
- `prose inspect`
- `prose status`
- `prose install`
- `prose examples`
- `prose help`
- `prose migrate`

For each:

- one-sentence purpose
- whether it runs inside the agent session
- link to canonical CLI docs

Do not document every flag unless the CLI README is generated from source or otherwise stays canonical.

## Existing Docs Site Audit

The current docs site already has a lot of the right bones. The main issue is not absence. It is drift risk and density.

Recommended changes:

1. Keep the existing overall sections, but reduce duplicated reference detail.
2. Make "skill is source of truth" much more explicit.
3. Add a clear "When not to use OpenProse" page or section.
4. Add "Your first useful workflow" after hello world.
5. Tighten install docs against the current CLI README.
6. Fix wording that implies Forme only wires by name equality.
7. Avoid implying exact runtime directory contents unless canonical specs guarantee them.
8. Make the docs homepage more direct and less card-driven.
9. Move deeper spec-like material behind links to the repo.
10. Add a short agent-facing page that is strict enough for agents to follow.

Specific likely stale spots to check before publishing:

- Install instructions that imply Anthropic is required.
- Any command that assumes `codex skills add` exists.
- First program text that says `model` frontmatter is required.
- Troubleshooting text that says Forme wiring is primarily name equality.
- Any claim that a shell `prose` binary is the VM.

## Tone

The tone should be:

- direct
- specific
- builder-to-builder
- intellectually alive
- slightly opinionated
- honest about tradeoffs
- allergic to generic AI product copy

The writing should feel like someone who has actually used the thing.

It can say:

> I use this when a workflow starts outgrowing my head.

It should not say:

> Our innovative platform empowers teams to unlock scalable AI-native automation.

The tweets often use casual lowercase and high-conviction phrasing. The docs do not need to copy the casing or rhythm exactly, but they should preserve the underlying qualities:

- plain words
- strong claims with concrete grounding
- willingness to say "this is overkill"
- occasional sharp contrast
- examples instead of abstractions
- no pretending the future is already fully solved

Good docs voice:

> OpenProse is not magic. It is a way to write down the shape of agent work so the model has something better than vibes to execute.

Probably too cute for docs:

> OpenProse is a new computational substrate for recursive institutional cognition.

The idea can be true and still be the wrong sentence.

## Key Wording To Use

These phrases are worth reusing across the site.

### Primary Description

> OpenProse is a programming language for AI sessions.

### Plain Explanation

> Write a Markdown contract. Your agent reads it, wires the services, runs the work, and leaves a trace.

### Use Case

> For workflows too big for one prompt and too flexible for a rigid framework.

### Contract Framing

> Contracts, not prompts.

> Describe what must be true, not every step the model must take.

### Runtime Framing

> The model plus harness acts as an intelligent VM.

> OpenProse runs inside the agent session.

### State Framing

> Pointers, not values.

> The trace is the record.

### Control Framing

> Declarative by default, explicit when needed.

> Start with a contract. Add wiring when relationships matter. Add execution when order matters.

### Honesty

> If it fits in one good prompt, use one good prompt.

> OpenProse is ceremony until the workflow needs a contract.

### Novelty

> Most orchestration frameworks control the model from outside. OpenProse gives the agent a program to execute from inside the session.

### Agent-Facing

> If you are an agent, load the skill. These docs are orientation, not the execution spec.

## Terms To Prefer

Use:

- AI session
- agent session
- model plus harness
- intelligent VM
- contract
- service
- program
- Forme
- container
- wiring
- manifest
- workspace
- bindings
- trace
- artifact
- pointer
- Prose Complete harness
- agent-native
- source of truth
- durable run
- reusable workflow

Use carefully:

- framework
- orchestration
- automation
- no dependencies
- deterministic
- compiler
- runtime

Avoid or minimize:

- unlock
- unleash
- empower
- seamless
- revolutionize
- transform your workflow
- AI-powered
- next-generation
- enterprise-grade
- robust at scale
- autonomous agents, unless the page needs that term
- multi-agent orchestration platform

"Multi-agent orchestration" is not forbidden, but it should not be the first identity. The first identity is "programming language for AI sessions."

## Recommended Message House

### Top Claim

OpenProse is a programming language for AI sessions.

### Support 1: It Makes Agent Work Reusable

OpenProse turns recurring prompts into versioned Markdown programs. You can review them, fork them, improve them, and run them again.

### Support 2: It Gives Agents Contracts

Programs declare what services require and ensure. This gives the model a typed shape to execute instead of a pile of instructions.

### Support 3: It Runs Where Agents Already Work

OpenProse runs inside Prose Complete harnesses like Claude Code, Codex, and other agent environments. The CLI is a wrapper into that session, not a replacement VM.

### Support 4: It Leaves A Trace

Runs write state, workspaces, bindings, and artifacts to disk. You can inspect what happened after the fact.

### Support 5: It Is Honest About Fit

One-off prompts should stay prompts. OpenProse is for workflows with enough shape to deserve a contract.

## Suggested Homepage Copy

This could be adapted almost directly.

```markdown
# OpenProse is a programming language for AI sessions.

Write a Markdown contract. Your agent reads it, wires the services, runs the subagents, passes artifacts through the filesystem, and leaves a trace on disk.

Plain prompts are great for one-off work. They get messy when the same process needs roles, handoffs, retries, memory, or a receipt. OpenProse gives that process a contract.

Use it when a prompt has started turning into a workflow.
Skip it when one good prompt is enough.
```

Another version with a little more edge:

```markdown
# Contracts for agent work.

OpenProse is a programming language for AI sessions.

It is for the moment when a prompt stops being a question and starts being a process: research, review, critique, synthesize, retry, write the report, leave the trace.
```

I prefer the first version for docs because it names the category immediately.

## Suggested "What Is OpenProse?" Copy

```markdown
OpenProse treats an agent session as a computer.

The model supplies judgment. The harness supplies tools, files, subagents, and state. OpenProse supplies the program format: Markdown contracts that describe services, inputs, outputs, constraints, and execution shape.

When you run an OpenProse program, the agent does not just answer a prompt. It reads the contract, resolves the services, creates a run, writes artifacts, and leaves a trace you can inspect.
```

## Suggested "When Not To Use It" Copy

```markdown
OpenProse is not the right answer to every agent task.

If you have a one-shot question, ask it directly. If the work fits in one response, do not wrap it in a program. If you need hard deterministic behavior, write ordinary code.

OpenProse starts to pay for itself when the work has roles, handoffs, retries, reusable constraints, or a trace you care about.
```

## Suggested Agent Page Copy

```markdown
# For AI agents

If you are an agent, this page is only a signpost.

Before running, editing, linting, or explaining an OpenProse program, load the `open-prose` skill. The skill and its linked specs are the source of truth for execution behavior.

Treat `prose run ...` as an in-session instruction unless your harness explicitly tells you otherwise. Do not assume the shell binary is the VM.
```

## Suggested Reference Overview Copy

```markdown
These docs are intentionally small.

They explain how to think about OpenProse and how to get started. The canonical behavior lives in the open source repo, especially the `open-prose` skill and its reference specs.

If this site and the skill disagree, trust the skill.
```

## How To Explain The CLI

The CLI needs careful wording because it is easy for users and agents to misunderstand.

Bad:

> The CLI executes OpenProse programs.

Better:

> The CLI is the shell entrypoint. It packages `prose run ...` into a canonical instruction for your agent harness. The OpenProse VM behavior still happens inside the agent session through the skill.

Good concise version:

> The CLI is a harness bridge, not a separate workflow engine.

Install docs should say:

> You can run OpenProse from inside an agent session, or use the CLI to ask a supported harness to run it for you.

This avoids making the binary sound more central than the skill.

## How To Explain Forme

Forme is likely the concept that makes OpenProse feel novel to experienced programmers. It should be introduced slowly.

Good first explanation:

> Forme is the part of OpenProse that wires services together. It reads what each service requires and ensures, then produces a manifest for the run.

Then:

> If you know Spring or another dependency injection container, the analogy is close: services declare contracts, and the container resolves the graph.

Then:

> The unusual part is that Forme is semantic. It can use the model's understanding of contracts, shapes, and constraints, not just string matching.

Avoid leading with:

> Forme is a semantic dependency injection framework for Markdown-defined agent components.

That may be accurate, but it is a rough first sentence.

## How To Explain ProseScript

ProseScript should not dominate the docs.

Recommended framing:

> Most OpenProse programs should start as Contract Markdown. Use ProseScript when the order of operations matters enough to pin down.

One useful rule:

> Contract Markdown describes the desired shape of the work. ProseScript describes the choreography.

Do not turn the getting-started path into a ProseScript tutorial.

## How To Explain Standard Library Packages

The standard library is important, but it can quickly make the docs feel huge.

Recommended page treatment:

> The std package contains reusable roles, controls, composites, evals, memory patterns, and operational building blocks. Use it when you recognize a common shape instead of writing a bespoke service every time.

Then give a small table:

| Package | What it is for |
| --- | --- |
| `roles` | Small reusable agent jobs like critic, verifier, summarizer, researcher |
| `controls` | Reusable flow shapes like pipeline, retry, race, fallback |
| `composites` | Multi-role structures like worker-critic or ensemble-synthesizer |
| `evals` | Programs that inspect or score runs |
| `memory` | Patterns for persistent context |

Do not copy every role/control/composite into the docs site. Link to package READMEs.

## How To Explain Self-Improvement

Self-improvement is interesting and real in the repo, but it should not be the first promise.

Use later, in examples or "Why this matters":

> Because OpenProse programs are Markdown contracts, agents can inspect and improve them. The project already contains programs that review OpenProse runs and propose better OpenProse.

Avoid:

> OpenProse recursively improves itself into an autonomous software factory.

The first version is credible. The second sounds like a pitch deck.

## Relationship To Other Tools

This can be one page or a short FAQ section.

The docs should not spend too much time naming competitors. It should explain the axis.

Suggested copy:

> Most agent workflow frameworks orchestrate from outside the model. You write Python or TypeScript that calls models, routes outputs, and manages state.
>
> OpenProse starts from the other side. The workflow is a Markdown program that the agent reads and executes inside its own session.

Then:

> That tradeoff is not universally better. External frameworks are often right when you need deterministic APIs, tight product integration, or conventional service infrastructure. OpenProse is right when the workflow depends on agent judgment and you want the process itself to remain readable, portable, and versioned.

This is fair and strong.

## Conceptual Diagrams

The docs site probably needs only two diagrams.

### Diagram 1: Run Flow

```text
program.md
  -> Forme reads contracts
  -> manifest.md
  -> VM creates run
  -> services work in private workspaces
  -> outputs copied to bindings
  -> trace remains on disk
```

### Diagram 2: Control Ladder

```text
Contract
  "what must be true"

Wiring
  "which services connect"

Execution
  "what order to run"
```

Keep diagrams plain. Fancy architecture art would fight the voice.

## Documentation Principles

Use these as editorial rules.

### 1. Start With The Weird But Useful Claim

Do not bury the thesis.

Say:

> OpenProse is a programming language for AI sessions.

Then explain.

### 2. Run Before Theory

Users should see a program and a run before reading about Forme in depth.

### 3. Say When It Is Overkill

This project becomes more trustworthy when it tells people not to use it.

### 4. Link To Canonical Specs

Do not duplicate normative details.

### 5. Prefer Examples Over Abstractions

Every concept page should contain a small concrete program fragment.

### 6. Keep Agent Instructions Sharp

Agents need imperatives, not vibes:

- load the skill
- do not infer semantics from docs
- treat `prose run` as in-session
- pass artifacts by path
- use workspaces and bindings

### 7. Keep Humans Oriented

Humans need:

- why this exists
- what to install
- what to run
- what to inspect
- what to read next

## Editorial Style Guide

### Sentence Shape

Prefer short sentences with real nouns.

Good:

> The run leaves a trace on disk.

Bad:

> The execution lifecycle provides persistent observability across autonomous workflow operations.

### Claims

Make strong claims, then ground them.

Good:

> OpenProse is not a Python orchestration library. The workflow lives in Markdown and runs inside the agent session.

Bad:

> OpenProse redefines the future of intelligent automation.

### Uncertainty

Use honest uncertainty when appropriate.

Good:

> This is early, and the conventions are still settling.

Good:

> For a small one-off task, this is probably not worth it.

Bad:

> OpenProse is production-ready for every agent workflow.

### Metaphors

Use metaphors that carry technical meaning:

- VM
- container
- contract
- type system
- pointers
- trace
- rails

Avoid decorative metaphors that do not help the reader operate the system.

### Humor And Edge

The docs can be dryly direct, but should not become performative.

Good:

> If it fits in one prompt, please do not make it a program.

Too much:

> If you are still doing this with raw prompts, what are you even doing.

Twitter can carry more edge than docs. The docs should retain conviction without sounding like a thread.

## Suggested Rewrite Of The Current Information Architecture

The current docs can be reshaped without throwing everything away.

Potential target tree:

```text
content/docs/
  index.mdx

  start/
    what-is-openprose.mdx
    install.mdx
    first-program.mdx
    first-useful-workflow.mdx

  think/
    contracts-not-prompts.mdx
    services-forme-vm.mdx
    workspaces-bindings-traces.mdx
    when-to-use-it.mdx

  use/
    examples.mdx
    patterns.mdx
    troubleshooting.mdx

  agents/
    for-ai-agents.mdx

  reference/
    overview.mdx
    commands.mdx
    specs.mdx
```

Existing pages can map into this:

| Current page | Proposed fate |
| --- | --- |
| `get-started/introduction` | merge into `start/what-is-openprose` |
| `get-started/why-openprose` | split into homepage, `when-to-use-it`, and concepts |
| `get-started/install` | keep, update against CLI |
| `get-started/your-first-program` | keep, simplify and verify |
| `get-started/for-ai-agents` | move to `agents/for-ai-agents`, make stricter |
| `concepts/services-and-programs` | merge into `services-forme-vm` |
| `concepts/contracts` | rewrite as `contracts-not-prompts` |
| `concepts/forme` | merge into `services-forme-vm` |
| `concepts/intelligent-vm` | merge into `services-forme-vm` and `workspaces-bindings-traces` |
| `guides/composing-multi-agent-workflows` | turn into `use/patterns` |
| `guides/from-toy-to-production` | use material in `first-useful-workflow` and `patterns` |
| `reference/*` | keep shallow, link out |
| `examples/*` | curate behind `use/examples` |

This is intentionally less sprawling.

## The Most Important Missing Page

The most important missing page is:

> When to use it

It should include "when not to use it" on the same page.

This page is the antidote to AI slop because it shows taste. It says the tool has a real shape and a real boundary.

Suggested structure:

```markdown
# When to use OpenProse

Use OpenProse when a prompt has become a process.

## Good fits

- recurring workflows
- multi-role work
- parallel exploration
- review and critique loops
- workflows that need traces
- workflows that pass artifacts between steps

## Bad fits

- one-shot questions
- quick edits
- live back-and-forth thinking
- deterministic systems better written as code

## A quick test

Would you care what happened after the run?
Would you run it again?
Would another agent need to understand the handoff?

If yes, write a contract.
```

## The Most Important Agent-Facing Sentence

The most important agent-facing sentence is:

> If you are an agent, load the `open-prose` skill. These docs are orientation, not the execution spec.

This should be repeated anywhere an agent might land from search.

## The Most Important Human-Facing Sentence

The most important human-facing sentence is:

> OpenProse is for the moment when a prompt turns into a process.

This sentence carries the use case, the boundary, and the emotional truth of the project.

## Open Questions Before Rewriting The Site

These are worth deciding before implementing the docs refresh.

1. Should the public quickstart use `npx skills add openprose/prose` as the only default, with CLI second?
2. What exact npm command should be considered canonical for the CLI today?
3. Should the first useful workflow be parallel reviews, agent-readiness scan, or controlled-burn exploration?
4. Should the docs link directly into GitHub source files for the skill specs, or mirror a short canonical spec index inside the docs repo?
5. Should `Prose Complete harness` be introduced on the first page or deferred until concepts?
6. How much of Press/cloud should appear in docs now? My recommendation: almost none in the core docs, except where needed to explain the long-term architecture.

## Recommended Immediate Next Edits

If we turn this strategy into implementation, I would do it in this order:

1. Rewrite `content/docs/index.mdx` around the core sentence and a tiny program.
2. Rewrite install instructions against the current CLI and skill README.
3. Add `when-to-use-it.mdx`.
4. Add or rewrite `for-ai-agents.mdx` with the source-of-truth policy.
5. Add `first-useful-workflow.mdx`.
6. Collapse concept pages into fewer, sharper pages.
7. Replace duplicated reference detail with links to canonical repo files.
8. Review every page for AI-slop words and remove them.

## Final Positioning

The docs site should leave people with this understanding:

OpenProse is not a chatbot prompt template collection.

It is not a Python workflow framework.

It is not a hosted automation product.

It is a Markdown programming language for agent sessions: contracts, services, wiring, execution, workspaces, bindings, and traces.

It is useful because modern agents are already powerful enough to act like computers, but raw prompts give that power too little shape. OpenProse gives the session a program.

That is the story. Keep it that simple.
