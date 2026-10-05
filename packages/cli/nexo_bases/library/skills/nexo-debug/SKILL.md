---
name: nexo-debug
description: Find the root cause of a bug before fixing it, then fix it with a test that proves it. Use for non-trivial bugs, failing tests, flaky behavior, or when a first fix did not work.
owner: nexo
version: 1.0.0
---

# nexo-debug

No fix without a root cause. Guessing wastes more time than investigating.

## Steps

1. **Reproduce.** Get a command, test or click path that shows the bug every time. Can't
   reproduce → gather evidence (logs, versions, inputs) before anything else.
2. **Locate.** Narrow down: recent changes (`git log`, `git diff`), boundaries between components,
   inputs vs outputs at each step. Add temporary logging if needed.
3. **Explain.** Write the root cause in one or two sentences: *what* is wrong and *why* it produces
   the symptom. If you can't, keep investigating.
4. **Prove.** Write a failing test (or a reliable reproduction script) for that cause.
5. **Fix** the cause, not the symptom. Run the test: it must pass, and the rest of the suite too.
6. **Clean up** temporary logging.
7. Record the cause in the ticket or `context/` if it may recur.

## Stop and ask when

- Three fixes failed: the model of the problem is wrong — step back to step 2 with the user.
- The fix needs a risky change (data, auth, production).

## Does not

- Ship a fix whose cause it cannot explain.
