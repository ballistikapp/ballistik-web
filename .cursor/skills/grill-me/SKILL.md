---
name: grill-me
description: >-
  Stress-test a plan or design by interviewing the user about every consequential
  decision before writing a concrete plan. Use when the user wants to be grilled,
  stress-test a design, or says "grill me".
disable-model-invocation: false
---

# Grill Me

## Goal

Reach shared understanding on every decision that would change the plan, before writing the plan.

## Process

1. If a question can be answered from the codebase or attached context, investigate first. Only ask what you genuinely cannot determine.
2. If multiple high-level directions are viable, ask the user to pick the direction first. Do not ask detailed questions gated on an unmade higher-level decision.
3. Group remaining open questions by topic and ask them in batches. For each question include:
   - the question
   - your recommended answer (default)
   - one line on why it matters / what it blocks
4. Skip questions that don't change the outcome. Record obvious choices under "Assumptions" instead of asking.
5. Stop when every branch has either a user decision or a recorded assumption. Then produce a short decision log (decisions + assumptions) and hand off to planning.

Be concise. No filler questions.
