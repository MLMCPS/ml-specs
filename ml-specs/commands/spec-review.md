---
description: Adversarially review a draft spec BEFORE any code — checks contracts, acceptance criteria, and cross-module ripple are complete and testable
argument-hint: <path to spec file, e.g. specs/0001-foo.md>
---

Spec: **$ARGUMENTS**

Use the **spec-reviewer** agent to review this spec adversarially, before any code exists. It
runs read-only and with fresh context — it reports what needs changing rather than editing the spec.

`/ml-specs:spec` already runs this pass on every spec it writes. Reach for this command when the spec was
written by hand, was edited substantially since it was drafted, or came from someone else.

Relay the agent's verdict: the per-check results, the must-fix list, and its final **approve** /
**revise** / **split** call. Separate the must-fixes the agent says are resolvable from the code
from the ones needing a human contract decision — offer to fix the first group, and put the second
to the user with the AskUserQuestion tool as concrete options with a recommendation, not as open
questions.

Do not start implementation, and do not change the spec's Status — that's `/ml-specs:spec-advance`. After a
clean review and the human's approval: `/ml-specs:spec-advance <spec-file> Approved` → `/ml-specs:spec-build <spec-file>`.

(This reviews the **paper**. Its counterpart, `/ml-specs:spec-verify`, reviews the **code** against that
paper once it's built.)
