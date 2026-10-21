# claude-skills

William Minchin's Claude Code skills, as a plugin marketplace
(`minchinweb-skills`).

## Install (any machine)

Git needs access to the (private) repos, e.g. `gh auth login` then
`gh auth setup-git`.

```
/plugin marketplace add minchinweb/claude-skills
/plugin install python-style@minchinweb-skills
```

Update with `/plugin marketplace update minchinweb-skills`.

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

## Working on it

Clone with `--recurse-submodules`. After the guide changes, bump the pointer:

```
git -C plugins/python-style/python-style-guide pull
git add plugins/python-style/python-style-guide
```

Check with `claude plugin validate .`.
