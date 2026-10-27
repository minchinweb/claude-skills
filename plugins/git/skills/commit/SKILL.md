---
name: commit
description: Commit with a generated message, like Cursor's /commit. Commits what's staged, or with nothing staged, only the files and hunks Claude changed this session; writes a 🤖-prefixed message in the style of the repo's recent commits. Use when the user says "commit", "commit this", "write a commit message", or types /commit.
argument-hint: "[hint for the message]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git apply:*), Bash(git commit:*), Bash(git branch:*), Bash(git switch:*)
---

# Commit the current changes (`/git:commit`)

Like Cursor's `/commit`: look at what changed, write the message, commit. Don't
ask for approval of the message first; the user asked for a commit.
`$ARGUMENTS` is an optional hint about what the change is for.

## Repo state (loaded when the skill starts)

- Branch: !`git branch --show-current`
- Status: !`git status --short`
- Staged: !`git diff --cached --stat`
- Unstaged: !`git diff --stat`
- Recent subjects: !`git log -n 15 --format=%s`

## Steps

1. **Pick what to commit.** Never commit changes Claude didn't make and the
   user didn't stage.
   - **Something is staged:** commit exactly that. Stage nothing more.
   - **Nothing staged:** stage only what Claude changed in this session.
     Look back through the conversation for the files Claude wrote or edited.
     - A file only Claude touched (or created): `git add <file>`.
     - A file with other changes too: stage only Claude's hunks. Save
       `git diff -- <file>` to a patch in the scratchpad, keep just Claude's
       hunks, and `git apply --cached <patch>`. If one hunk mixes Claude's
       and the user's edits, ask before staging it.
     - Before committing, list the files (and partly staged files) included.
   - **Nothing staged and Claude changed nothing** (e.g. a fresh session):
     say so and ask the user to stage what they want committed. Stop.
   - Never stage secrets or local junk (`.env`, keys, credentials, build
     output); name them and leave them out.

2. **Read the staged diff** (`git diff --cached`). For a very large diff, read
   the `--stat` and the most important files rather than all of it.

3. **Write the message.**
   - The subject starts with `🤖 `, always, e.g. `🤖 Fix path handling on
     Windows`. If the repo's subjects also use another prefix
     (`type(scope):`, ticket numbers), put it after the emoji.
   - Otherwise match the recent subjects: tense, mood, casing. Follow any
     commit rules in CLAUDE.md.
   - Subject: one line, about 50 characters, at most 72, no trailing full
     stop. Say what the change does, not which files it touches.
   - Body only when the *why* isn't obvious from the subject, or the commit
     does several things: a blank line, then short wrapped lines or bullets.
   - Use the hint in `$ARGUMENTS`, if any, for intent the diff can't show.
   - End with any attribution lines the session asks for.

4. **Commit**, passing the message through a heredoc so quoting survives:

   ```
   git commit -F - <<'MSG'
   <message>
   MSG
   ```

   If a hook fails, show its output. If the fix is in the staged changes
   (e.g. formatting), fix it, re-stage only those files and commit again.
   Never use `--no-verify` or `--amend` unless the user asks.

5. **Report** the short hash and subject, and any changes left uncommitted.
   Don't push.

## Branch guard

On the default branch (`main`/`master`), commit anyway (Cursor does), unless
the user's instructions say to branch first; then `git switch -c` a branch
named after the change, commit there, and say so.
