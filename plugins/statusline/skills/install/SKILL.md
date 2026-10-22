---
name: install
description: Install MinchinWeb's Claude Code status line (directory shortened to fit the terminal, git branch, model, context, session and week usage) on this machine. Use when the user asks to install, set up, sync or update their status line, or is setting up Claude Code on a new computer.
---

# Install the status line (`/statusline:install`)

Copies the bundled `statusline.sh` to `~/.claude/` and points `statusLine` in
`~/.claude/settings.json` at it. The script is the source of truth; this skill
doesn't restate what it does.

## Steps

1. **Run the installer:**

   ```
   python ${CLAUDE_SKILL_DIR}/scripts/install.py
   ```

   - Exit 0: installed or updated. Report what it printed.
   - Exit 2: a *different* status line is already configured, and nothing was
     changed. Show the user the existing command and ask whether to replace
     it. Only on a yes, re-run with `--force` (it saves the old one to
     `~/.claude/statusline.previous.json`).
   - Exit 1: `settings.json` isn't valid JSON. Tell the user; don't edit it by
     hand.
2. **If the installer reported an old `statusline.sh` was backed up** (the
   installed copy differed from the bundled one), warn the user: either the
   plugin is newer, or they edited the installed copy. Point at
   `statusline.sh.bak` so they can merge local edits into the plugin.
3. **Tell the user it needs `bash` on the PATH** (Git Bash on Windows) and that
   the new status line shows at the next refresh, or after a restart.

A fresh machine has no `statusLine` key, so the default case installs without
asking anything.

## Updates

A `SessionStart` hook (`hooks/hooks.json`) runs `install.py --update` each
session. It silently replaces `~/.claude/statusline.sh` with the plugin's newer
copy, but only if the installed file is still exactly what this skill last wrote
(its hash is in `~/.claude/statusline.sha256`). If it has local changes, or
predates auto-update, the hook leaves it and shows a one-line warning; running
this skill then backs it up as `statusline.sh.bak` and installs the new one.
Machines that never installed it, or use a different status line, are untouched.

For the plugin itself to update on its own, turn on auto-update for the
`minchinweb-skills` marketplace in `/plugin` (off by default for third-party
marketplaces).

## Keeping this in sync

The copy in this folder is the master. After the user changes their status line
(`~/.claude/statusline.sh` or the `statusLine` setting), update
`statusline.sh` here to match, bump the changelog, and tell the user to push.
