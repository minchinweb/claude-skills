---
name: alerts
description: Fix a repo's open Dependabot security alerts. Reads the alerts from GitHub, raises the matching minimums in every pyproject (direct dependencies) and constraint-dependencies (transitive ones), relocks, and ships the fix as a git-flow hotfix branch cut from the latest release tag, in its own worktree. Use when the user asks about Dependabot alerts, security alerts, or shipping a security fix. Ends by asking whether to merge the hotfix branch in. Never merges, tags or pushes on its own.
argument-hint: "[optional: only these packages, or a severity floor]"
allowed-tools: Bash(gh api:*), Bash(git:*), Bash(uv:*), Bash(python:*), Bash(sed:*), Bash(ls:*), Bash(cat:*), Bash(grep:*)
---

# Fix Dependabot alerts (`/dependabot:alerts`)

Takes the repo's open Dependabot security alerts to a hotfix commit, then asks
whether to merge it. Follows git-flow as the repo's CLAUDE.md describes it: a
hotfix comes from `master` at the release tag, holds only the fix and its
changelog line, is released as a patch, then goes into `dev` too.

`$ARGUMENTS` optionally narrows the work (named packages, or a severity such as
`high`). With no arguments, fix every open alert.

This skill works on a branch and stops at a question. It does not merge into
`master` or `dev`, tag, or push.

## Repo state (loaded when the skill starts)

- Current branch: !`git branch --show-current`
- Status: !`git status --short`
- Latest tags: !`git tag --sort=-v:refname | head -5`
- Worktrees: !`git worktree list`

## Steps

1. **Read the open alerts.** This is the first step, before anything else.
   ```
   gh api "repos/{owner}/{repo}/dependabot/alerts?state=open" --paginate
   ```
   `{owner}/{repo}` is filled in by `gh` from the current checkout. For each
   alert, keep: the package name, the ecosystem, the manifest path, the
   vulnerable range, the first patched version, and the severity.
   - No open alerts: say so and stop.
   - `gh` not installed or not signed in, or a 403/404: say which, and ask the
     user to paste the alerts (or run `gh auth login` themselves). Don't guess
     the list.

2. **Work out the minimum per package, with real version comparison.** Group
   the alerts by package. The minimum to set is the *highest* first-patched
   version among that package's alerts. Compare with `packaging.version.Version`
   (`uv run python -c ...`), never by string: `"5.2.9" > "5.2.17"` as strings,
   and that mistake undersells the fix. Keep the severities and count per
   package for the report.
   - If `$ARGUMENTS` narrows the set, fix only those and list what was left out.

3. **Map each package to where it is pinned.** Search every `pyproject.toml` in
   the repo, not just the root (`grep -rn '"<package>[<>=~]' --include=pyproject.toml`).
   - **Direct dependency** (listed in a `dependencies` array): raise the floor in
     each file that lists it, keeping any trailing comment.
   - **Transitive only** (in `uv.lock`, not in any pyproject): add it to
     `constraint-dependencies` under `[tool.uv]` in the root `pyproject.toml`,
     with the comment `# minimums for security (transitive; from Dependabot alerts)`
     above the block. A constraint is a minimum, so it forces the upgrade in the
     lock without pinning anything else.
   - **Major-version cap:** if the fix is in the same major as a pinned line
     (Django 5.2 with a fix in 5.2.17), add a `,<6`-style upper bound to the
     current major. Without it, `uv lock` picks the newest major (Django 6.1 in
     the last run), which is not a security patch.

4. **Pick the base and the branch name.**
   - The base is the newest `vX.Y.Z` tag, and `master`'s last commit should be
     its `🤖 [release] X.Y.Z` commit. If it isn't, ask before going on: the
     hotfix may belong on an unreleased base.
   - Version: the next patch number (`1.1.0` → `1.1.1`). A fix that adds a
     feature or breaks something is a minor or major release, not a hotfix:
     say so and stop.
   - Branch: `hotfix/<version>`. Check `git branch --list` and
     `git ls-remote --heads origin 'hotfix/*'`. If the name is taken, never
     touch that branch: it may be someone else's work. Use the next free patch
     number and say why.

5. **Work in a new worktree.** Never switch branches in the current checkout;
   it may hold unrelated uncommitted work.
   ```
   git worktree add -b hotfix/<version> "<sibling dir>/<repo>-hotfix-<version>" <tag>
   ```
   The sibling directory sits next to the main checkout. Work only there from
   now on.

6. **Carry the edits over from the base, not from `dev`.** `dev` usually has
   unreleased changes, so copy the *edits*, not the files.
   - Make the step 3 edits in the worktree, only in files that exist at the
     tag. Files that only exist on `dev` are skipped; name them in the report.
   - If the current checkout already has these edits uncommitted, save them
     first: `git diff > <scratchpad>/<name>.patch`. Leave the checkout alone.
     Don't discard anything.

7. **Relock and read what moved.**
   - `uv lock`, then `uv lock --check`.
   - Diff the lock (`git diff -- uv.lock`, or the `name = / version =` pairs).
     Check: the packages the alerts name moved to at least their minimums, no
     major version moved unless the cap in step 3 allows it, and the list of
     unrelated packages that moved. Those are side effects. Report them and
     offer to pin them back. Don't pin them yourself.

8. **Changelog.** Add a line at the top of `CHANGELOG.rst`, above the newest
   `:release:` line, as ``- :bug:`-` <what changed>``. Keep the version as it
   is: the release commit sets it, not the hotfix.

9. **Verify in the worktree.**
   - `uv lock --check`, `uv sync`, and an import of each package that was
     bumped, printing its version.
   - The test suite: `uv run invoke test`. It takes about 40 minutes. Run it in
     the background, log to the scratchpad, and wait with a monitor on the exit
     line (not by polling). A suite that runs past its time limit or stalls is a
     result to report, not a reason to re-run blindly.
   - If the worktree has no `.env` and the Django suite needs one, say so rather
     than inventing settings.
   - A failing test stops the run. Report it and don't commit.

10. **Commit** on the hotfix branch. Subject: `🤖 [deps] <what it does>`. Body:
    the alert numbers or packages and the *why* if it isn't obvious. End with
    the attribution lines the session asks for. Use a heredoc:
    ```
    git commit -F - <<'MSG'
    <message>
    MSG
    ```
    Never `--amend`, `--no-verify`, or push.

11. **Report and ask.** Give: the branch, the worktree path, the commit hash and
    subject, the alerts covered (and any left out), the files changed, the
    verification results, and the side effects from step 7. Note that the
    alerts close only after the fix reaches the default branch. Then ask with
    `AskUserQuestion` whether to merge `hotfix/<version>` in now. Options:
    - "Merge into master, tag, then merge into dev" (the full git-flow path; the
      tag and release commit need their own go-ahead).
    - "Merge into master only, for now".
    - "Leave the branch as it is".
    Don't merge on your own, even if the user asked for the fix.
