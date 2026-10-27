# claude-skills

William Minchin's Claude Code skills, as a plugin marketplace
(`minchinweb-skills`).

## Install (any machine)

```
/plugin marketplace add minchinweb/claude-skills
/plugin install python-style@minchinweb-skills
/plugin install statusline@minchinweb-skills
/plugin install git@minchinweb-skills
```

Update by hand with `/plugin marketplace update minchinweb-skills`.

### Auto-update

Third-party marketplaces don't update themselves by default. To turn it on, on
each machine:

1. Run `/plugin` and open the **Marketplaces** tab.
2. Select `minchinweb-skills`.
3. Choose **Enable auto-update**.

Claude Code then refreshes the marketplace and its plugins at startup. The
`statusline` plugin also refreshes your installed `~/.claude/statusline.sh` at
the start of each session, unless you've edited it (then it warns instead; run
`/statusline:install` to review).

## Plugins

### `python-style`

Bundles [python-style-guide](https://github.com/minchinweb/python-style-guide)
(a git submodule inside the plugin: a plugin can't read files outside its own
folder) with two skills:

- `/python-style:audit` -- audit and fix one project against the guide, or
  start a new one from its templates.
- `/python-style:survey` -- audit every Python repo in a folder and write a
  summary to `DEVIATIONS.md`. That file names your local projects, so it is
  written to this machine only (default `${CLAUDE_PLUGIN_DATA}`), never into a
  repo.

### `statusline`

- `/statusline:install` -- install my status line on a new machine.
  Copies `statusline.sh` to `~/.claude/` and sets `statusLine` in
  `settings.json`. A machine with no status line configured installs without
  asking; a different existing one is left alone until you confirm, and the old
  one is saved.

**Keep it in sync:** the copy in
`plugins/statusline/skills/install/statusline.sh` is the master.
Whenever you change your status line, update that file too and push.

### `git`

- `/git:commit` -- commit with a generated message, like Cursor's `/commit`.
  Commits what's staged; with nothing staged, only the files (and hunks) Claude
  changed this session. The subject always starts with 🤖 and otherwise follows
  the repo's recent commits. Never pushes.

## Working on it

Clone with `--recurse-submodules`. After the guide changes, bump the pointer:

```
git -C plugins/python-style/python-style-guide pull
git add plugins/python-style/python-style-guide
```

Check with `claude plugin validate .`.

## Development

This is a *tooling* repo in the guide's terms (`kind = "tooling"`): scripts and
plugins, never built as a package.

```
uv sync
uv run invoke format   # ruff + taplo, applies fixes
uv run invoke check    # lint, format check, pyproject check, tests
```
