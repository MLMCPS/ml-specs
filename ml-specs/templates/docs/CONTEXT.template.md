# Project context

> What this project is for, who uses it, and the constraints that are **not derivable from the
> code**. Optional — a project without one is not missing anything, and no command fails because
> it is absent.
>
> Seeded by `/ml-specs:repo-init`, refreshed by `/ml-specs:repo-refresh`. Neither overwrites prose
> a human wrote.

## Why this file and not `CLAUDE.md`

`CLAUDE.md` says what the repo *is* and points at the rest. This holds the **why** — the decisions,
the constraints and the history that shaped the code and that reading the code cannot recover.
The two must not copy each other: if a fact is derivable from the source, it does not belong here.

## What this is for

<The problem it solves, in a few sentences. Not the architecture — that is `docs/ARCHITECTURE.md`.>

## Who uses it

<Which humans or systems, and what they need from it. A constraint that exists because of a user
is invisible in the code and expensive to rediscover.>

## Constraints that are not in the code

<Regulatory, contractual, operational or historical. Examples of the shape:>

- <A rule imposed from outside — a regulation, an SLA, a partner's API limit.>
- <A decision already taken that is expensive to revisit, and why.>
- <A thing that looks wrong in the code and is deliberate — with the reason, so the next person
  does not "fix" it.>

## What we deliberately do not do

<Scope boundaries somebody keeps proposing. Writing them down once is cheaper than re-arguing
them, and a rejected idea with a recorded reason stops coming back.>
