You are ONE iteration of an autonomous build loop. A fresh instance of you runs
each time with NO memory of previous runs — everything you need is on disk.

Read these first; they are the source of truth:
- CLAUDE.md — the rules and the task cycle. Follow it exactly.
- PLAN.md   — the task queue.
- SPEC.md   — the design (the what and why).

YOUR SINGLE JOB THIS RUN:

1. Find the FIRST unchecked task in PLAN.md — a line beginning "- [ ] T".
   Work on that ONE task only. Do not look at or start any later task.

2. If that task is too large to finish cleanly in one session, do NOT half-build it.
   Instead, rewrite that single task line as 2–3 smaller "- [ ]" subtasks
   (e.g. T1 becomes T1a, T1b, T1c), then complete only the FIRST subtask this run.

3. Implement the smallest change that satisfies the task's acceptance criterion.
   If you add a source file, add its test in the same run.

4. Verify, in order:
     npm test
     npm run check --if-present
   If either fails, fix and re-run — up to 3 attempts.

5. When BOTH pass:
   - change that task's "- [ ]" to "- [x]" in PLAN.md
   - commit everything:  git commit -am "<task id>: <short summary>"
   Then STOP. The loop will start the next task in a fresh session.

6. If still failing after 3 attempts:
   - leave the box unchecked
   - add a one-line "BLOCKED: <reason>" note directly under the task
   - do NOT commit broken code
   - STOP.

HARD LIMITS — do not violate:
- ONE task per run. No bonus work, no refactors outside the task's scope.
- NEVER commit while `npm test` is failing.
- NEVER edit ralph.sh, prompt.md, CLAUDE.md, or SPEC.md.
- In PLAN.md you may ONLY: tick the current task's box, add a BLOCKED note, or
  split the current task into subtasks (step 2). Never touch other tasks.
- Use the libraries named in SPEC.md. Do not add dependencies no task asked for.

If there are NO unchecked tasks left in PLAN.md, change nothing and reply exactly:
ALL TASKS COMPLETE
