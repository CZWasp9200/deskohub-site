---
name: deskohub-pr-review
description: Pull request, PR review feedback, review threads, code review round, regression fix, UI screenshots, PR screenshot upload, ready for review, mergeable.
---

# Deskohub PR review

## Review rounds

- Give an independent read-only reviewer a fixed revision or diff hash, the diff itself, acceptance criteria, changed files, test evidence, and known risks, so the review doesn't depend on running commands. A fixed uncommitted diff is fine.
- Route accepted findings to whoever owns that code, reverify, and return to the same reviewer until it approves. Then run final verification.
- Commits are publishing steps that need user authorization, not a prerequisite for each review round.

## Fixes

- For a bug raised in review, first add a regression test against the current implementation and confirm it fails.
- Don't change production code for states the application can't produce.

## Screenshots

Every PR that introduces or changes UI needs a screenshot of each newly introduced visible state, posted to the PR.

- Capture the exact committed and pushed code, preferably from its immutable preview deployment.
- Cover states that differ in copy, layout, interaction result, or responsive presentation. Cover states that render nothing with tests, not empty screenshots.
- Upload through GitHub; don't commit screenshots unless they're durable documentation or test fixtures. Never use Cloudinary.
- With a GitHub browser session, use the `gh image` extension for native `user-attachments` uploads. Headless, upload synthetic-only screenshots as release assets in `totalolage/gitshot-images` and embed their URLs with `gh pr comment`.

## Completion

- At a planned stopping point, mark the PR ready for review instead of leaving it in draft.
- Local verification is a checkpoint, not the finish. Continue through review, commit, push, screenshot evidence from the deployment, thread resolution, and required checks until the PR is mergeable. Stop earlier only when the user pauses the work or a blocker needs their input.
- After a fix is pushed and validated, reply to each addressed thread with a short summary and resolve it.
