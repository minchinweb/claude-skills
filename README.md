# claude-skills

William Minchin's Claude Code skills, as a plugin marketplace.

## Install (any machine)

Git needs access to the (private) repos, e.g. `gh auth login` then
`gh auth setup-git`.

```
/plugin marketplace add minchinweb/claude-skills
/plugin install python-style-audit@minchinweb-skills
```

Update with `/plugin marketplace update minchinweb-skills`.

## Plugins

- `python-style-audit` -- audits and updates a Python project against
  [python-style-guide](https://github.com/minchinweb/python-style-guide), which
  is a git submodule inside the plugin (a plugin can't read files outside its
  own folder). Invoked as `/python-style-audit:python-style-audit`.

## Working on it

Clone with `--recurse-submodules`. After the guide changes, bump the pointer:

```
git -C plugins/python-style-audit/python-style-guide pull
git add plugins/python-style-audit/python-style-guide
```

Check with `claude plugin validate .`.
