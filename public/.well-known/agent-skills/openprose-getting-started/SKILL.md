---
name: openprose-getting-started
type: documentation
---

# OpenProse Getting Started

Help a developer state what an agent must accomplish, which requirements it
must satisfy, and where it can choose its approach.

## What is OpenProse?

Contract authoring is expressing intent by composing requirements. Reusable
contracts provide the building blocks; composition determines how their
requirements apply together. Distinguish the requirements from supplied inputs,
host capabilities, and evidence produced by a run.

These docs cover the public `open-prose` skill's Contract Markdown and
ProseScript format, checked against skill 0.18.0 (`runtime_contract: 2`).
A `responsibility` declares subscriptions in `### Requires` and maintained
state and postconditions in `### Maintains`. A `function` declares
`### Parameters` and `### Returns` for one-time calls. `### Invariants` states
limits; ProseScript under `### Execution` specifies required steps.
Use the syntax and semantics supported by the installed skill version.

## Install

The public language repository documents this installation command for
compatible coding agents:

```bash
npx skills add openprose/prose
```

Before running a contract, read it and establish the needed inputs, tools,
permissions, and host capabilities. Standing work needs a serving host;
writing a requirement alone does not start continuous execution. A receipt
records a run and does not by itself prove that all requirements were satisfied.

## Next steps

- Read the authoring guide at https://docs.prose.md/declare-outcomes
- Read the setup guide at https://docs.prose.md/setup
- Read the agent-readable corpus at https://docs.prose.md/llms.txt
- Read the public skill at https://github.com/openprose/prose/tree/main/skills/open-prose
- Check host capabilities and implementation limits at https://docs.prose.md/harness-agnostic
