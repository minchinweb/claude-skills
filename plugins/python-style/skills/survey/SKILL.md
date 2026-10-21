---
name: survey
description: Survey many local Python projects against MinchinWeb's Python style guide and write a local-only DEVIATIONS.md summary (which projects break which STYLE.md rules). Use when the user wants an overview of all their projects, a migration plan or backlog across repos, "which of my packages still use black/isort/pip-tools/setup.py", or asks to regenerate or refresh DEVIATIONS.md. For fixing one project, use the audit skill instead.
---

# Python style survey (`/python-style:survey`)

Builds an overview of how a whole folder of projects differs from the guide.
The output names the user's local projects (some are private), so it is
written only to this machine and is never part of this plugin or the guide
repo.

## Steps

1. **Pick the inputs.** Root folder holding the repos: default to the current
   directory's parent if it contains many git repos, else ask (the user's is
   usually `D:\Code`). Output file: default
   `${CLAUDE_PLUGIN_DATA}/DEVIATIONS.md` (it survives plugin updates). Use a
   location the user names if they have one, but refuse any path inside a git
   repo that has a public remote, and say why.
2. **Run the survey:**

   ```
   python ${CLAUDE_SKILL_DIR}/scripts/survey.py <root> <out-file>
   ```

   It audits each Python repo directly under the root with the audit skill's
   `audit.py`, skips repos whose `origin` belongs to someone else (forks and
   upstream clones such as hass-core or pelican; pass `--include-forks` to
   include them), and writes a table by rule plus one line per project.
3. **Summarize for the user in chat:** the three or four rules hit by the most
   projects, which projects are closest to clean, and groups of projects that
   share the same gaps (these migrate together). Don't paste the whole file.
   Give the output path.
4. **Offer next steps**: auditing one project in detail with
   `/python-style:audit`, or ordering a migration by the biggest groups first.

## Notes

- Counts only clear deviations (`fix`); the `check` items need a human look
  and appear per project as a count.
- It is a mechanical survey. It doesn't know whether a project is a library
  or an app, or whether a deviation is deliberate; say so when you present it.
