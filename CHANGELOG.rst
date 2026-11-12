Changelog
=========

- :feature:`-` ``dependabot`` plugin: ``alerts`` skill reads a repo's open
  Dependabot alerts, raises the minimums, and ships the fix as a git-flow hotfix
  branch from the latest release tag, then asks before merging it in.
- :support:`-` update the bundled style guide to e5c6d32 (C8: every test suite
  includes an always-pass smoke test); the ``audit`` skill now lists C8 among
  the rules to check by eye.
- :feature:`-` ``audit`` checks H11 for the ``marketplace_repository`` link
  (Home Assistant 2026.11 and later), replacing ``hacs_repository``; the
  bundled style guide is now 7a0fbfb.
- :feature:`-` ``statusline`` script: shows a green ``rc`` at the far right
  while the session is under Remote Control.
- :feature:`-` ``audit`` checks rule H11 (Home Assistant projects need an
  "Install to my Home Assistant" ``hacs_repository`` link in ``README.md``).
- :support:`-` update the bundled style guide to 5c539f2: H11, the copyright
  and ``__future__`` rules, and ``SIM108`` ignored.
- :feature:`-` ``audit`` understands ``kind = "homeassistant"`` (STYLE.md
  section 9, H rules): Home Assistant custom integrations skip the packaging
  rules and are checked for the ``custom_components/<domain>/`` layout,
  ``manifest.json`` version, ``hacs.json``, test setup and HACS/hassfest CI.
- :bug:`-` ``audit`` accepts ``minchin.tasks`` (imported in ``tasks.py`` and
  as a dependency, which brings taplo and validate-pyproject) for D5, F8 and
  F9, matching the current templates.
- :feature:`-` ``git`` plugin: ``commit`` skill writes a 🤖-prefixed message
  and commits the staged changes, or with nothing staged, only what Claude
  changed this session.
- :feature:`-` ``statusline`` plugin: ``install`` skill installs the
  status line (directory shortened to fit the terminal) and warns before
  replacing a different one. A ``SessionStart`` hook refreshes an unmodified
  installed copy when the plugin updates.

- :feature:`-` ``audit`` accepts tasks imported from
  ``minchin.releaser.dev_tasks`` as satisfying the task rules (D5, F8).
- :feature:`-` ``audit`` accepts the changelog at ``CHANGELOG.rst`` or
  ``docs/changelog.rst`` (one copy only), and checks that ``invoke.yaml``
  points at it (rule L5).
- :feature:`-` ``python-style`` plugin: ``audit`` and ``survey`` skills, with
  the style guide bundled as a git submodule.
- :support:`-` follow the style guide's "tooling" kind: ruff, ``uv.lock``,
  ``tasks.py``, CI, and tests for ``audit.py`` and ``survey.py``.
- :feature:`-` ``audit`` flags release tags that aren't in ``vX.Y.Z`` form
  (rule L6).
- :release:`1.0.0 <2026-10-21>`
