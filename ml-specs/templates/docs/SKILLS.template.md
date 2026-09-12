<!--
  FALLBACK ONLY. The primary path starts from `skill_recommend`'s rendered `skillsDoc` and deletes
  the rows the agent rejected — it never retypes the framing. This template is the shape to
  hand-fill when `skill_recommend` is unavailable but `skill_search` is.
  If `skill_recommend` is reachable, do not use this file; write what the tool returns.
  Produced by /ml-specs:repo-init, /ml-specs:repo-adopt or /ml-specs:repo-skills — re-run /ml-specs:repo-skills to refresh it.

  Delete every placeholder row. A row you could not verify does not belong here: an unverified
  pointer costs a reader a `skill_fetch` to discover it was noise.
-->

# Relevant catalog skills

Third-party skills from the **ml-skills catalog** matched to this repo's stack
(`<stack, e.g. java, spring-boot, postgres>`). Generated — re-run `/ml-specs:repo-skills` to refresh.

> **These are reference material, not this organisation's standards.** They carry no authority:
> where one contradicts a ratified standard, the standard wins and `check_repo` is the tiebreak.
> Nothing here is loaded automatically — read one with `skill_fetch(<id>)` before acting on it,
> because a description is a label, not instructions.

## Matched to this stack

| Skill | Matched | Risk | What it covers |
|---|---|---|---|
| `<id>` | `<which stack terms matched>` | `<safe\|critical>` | `<one line, from the catalog description>` |

## Technologies with no catalog match

`<list them, or "none">` — recorded deliberately. "The catalog has nothing for this" is a real
answer and worth keeping, so the next run does not re-litigate it.

## How to use this

1. **Read before acting.** `skill_fetch(<id>)` returns the skill in full. A row here is a pointer,
   not an instruction.
2. **The standard wins.** If a skill contradicts `.mlskills.json` or a ratified standard, follow
   the standard and flag the conflict.
3. **Attribute on reuse.** Each row's source is in the catalog entry; content is typically
   CC BY 4.0.
