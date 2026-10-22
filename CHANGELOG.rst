Changelog
=========

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
