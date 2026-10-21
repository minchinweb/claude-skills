---
name: python-style-audit
description: Audit a Python project against William's Python style guide (python-style-guide/STYLE.md) and bring it into line, or set up a new Python project the same way. Use whenever the user asks to audit, lint-check, modernize, migrate or standardize a Python package or app; to move a project to uv, ruff or a pyproject.toml-only setup; to retire black, isort, flake8, pip-tools, setup.py or .requirements; to check filename casing, tests location or CI workflows; to start a new Python project or library; or says "match my style guide", even if they don't name the guide.
---

# Python style audit

The source of truth is `${CLAUDE_PLUGIN_ROOT}/python-style-guide/STYLE.md`
(a git submodule of the guide repo), with starting files in
`${CLAUDE_PLUGIN_ROOT}/python-style-guide/templates/`. This skill does not
restate the rules, because copies drift. Read `STYLE.md` at the start of every
run so you work from the current rules. If that folder is empty (the submodule
wasn't fetched), say so and stop: clone
`https://github.com/minchinweb/python-style-guide` and use that clone instead.
A local-only `DEVIATIONS.md` may sit beside `STYLE.md`; use it if present, but
never rely on it.

## Audit one project

1. **Read** `STYLE.md` (and the project's `CLAUDE.md`, if it has one: it may
   record why the project deviates on purpose).
2. **Run the mechanical checks** from the project's parent folder:

   ```
   python ${CLAUDE_SKILL_DIR}/scripts/audit.py <project-dir>
   ```

   It prints findings as `[rule] (level) message`, using the rule numbers in
   `STYLE.md`. Levels: `fix` is a clear deviation, `check` might be fine and
   needs a look, `info` is only informational. The script reads files and
   changes nothing. It cannot judge everything, so also skim the code for the
   judgement rules (C1-C7: type hints, Google docstrings, pathlib, logging,
   pytest style).
3. **Decide library or app.** A library is published to PyPI; an app is
   deployed. Several rules differ (`.python-version`, README format,
   single-version CI). If it's unclear, ask.
4. **Report** before changing anything: group by rule, say how many are `fix`
   versus `check`, and note anything that looks deliberate. Offer a plan.
   Do not start fixing until the user agrees, because a migration touches
   packaging and can break releases.

## Apply fixes

Work on a new branch, one concern per commit, in this order so each step
leaves the project working:

1. **Filenames and layout** (L4, L1): fix casing with a two-step `git mv`
   (to a temp name, then the right one); Windows is case-insensitive and a
   one-step rename is silently ignored. Remove `env/`; keep `.venv/`.
2. **Packaging** (P1-P6): fold `setup.py`/`setup.cfg`/`MANIFEST.in` into
   `pyproject.toml`; copy the shape from `templates/pyproject.toml`. Keep the
   project's existing values (name, URLs, classifiers, `requires-python`
   decisions). Keep the commented classifier menu.
3. **Dependencies** (D1-D6): inline `.requirements/base.in` into
   `[project.dependencies]` and `dev/docs/release.in` into
   `[dependency-groups]` (keep any version-floor comments), delete
   `.requirements/` and root `requirements*.txt`, then `uv lock`.
4. **Ruff** (F1-F9): replace the `[tool.black]`/`[tool.isort]`/`[tool.flake8]`
   tables with the template's ruff config, keeping real per-project settings
   (extra isort sections, per-file ignores, excludes). Remove black, isort,
   flake8 from dependencies. Run `uv run invoke format` once, and commit the
   mass reformat on its own so `git blame` can skip it.
5. **Tests** (L3): move top-level `test/`/`tests/` into
   `minchin/<name>/tests/` with `git mv`, fix relative imports, set
   `testpaths = ["minchin"]`, and run `uv run pytest`.
6. **Tasks and CI** (D5, F8, A1-A4): add `update`, `upgrade`, `lint`,
   `format`, `test`, `check` to `tasks.py` (keep existing tasks and the
   `minchin.releaser` import), copy `check.yml` and `test.yml` from the
   templates, remove `.pre-commit-config.yaml`.
7. **Verify**: `uv run invoke check` must pass, and `uv build` should produce
   a wheel that contains `minchin/<name>/tests` but no top-level `tests`.
   Re-run `audit.py` and show the before/after finding counts.

Things to be careful with:

- Never upgrade dependency versions or raise `requires-python` as a side
  effect of the migration; that is a separate decision for the user.
- Don't edit generated or vendored code (migrations, submodules, `_vendor`).
- If a fix would change published behaviour (the package contents, the entry
  points, the supported Python versions), stop and ask.
- Commit subjects start with a robot emoji (the user's global rule). Don't
  push unless asked.

## Start a new project

Copy the files from the guide's `templates/` into the new repo, rename `minchin.example`
(in `pyproject.toml`, `invoke.yaml` and the package folder), set
`requires-python` and the classifiers, then `uv sync` and
`uv run invoke check`. Ask whether it is a library or an app first.

## When the guide itself needs to change

If the user decides on a new convention, or a rule turns out wrong, edit
`STYLE.md` (and the templates and `scripts/audit.py` to match) rather than
working around it in one project. Keep rule numbers stable.
