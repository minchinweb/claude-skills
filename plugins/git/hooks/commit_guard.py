#!/usr/bin/env python3
"""PreToolUse hook: stop `git commit` when the secret gate finds a blocker.

Claude Code passes the tool call as JSON on stdin. For a Bash call that runs
`git commit`, scan what the commit will contain with secret_gate.py:

  - the staged changes, or
  - staged plus unstaged changes to tracked files when the commit uses -a/--all.

Exit 2 (with the findings on stderr) blocks the call and tells Claude why. Any
other outcome, including warnings only and "not a git repo", lets it through.

Limit: a single command that runs `git add` and then `git commit` is scanned
before the add happens, so newly added files in it are not seen. /git:commit
stages in a separate call, so it is covered.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

GATE = Path(__file__).resolve().parent.parent / "skills" / "commit" / "scripts" / "secret_gate.py"
COMMIT = re.compile(r"(?:^|[;&|\n]\s*)git\s+(?:-[Cc]\s+\S+\s+|--\S+\s+)*commit\b([^;&|\n]*)")
ALL_FLAG = re.compile(r"\s(?:-[a-zA-Z]*a[a-zA-Z]*|--all)(?=\s|$)")
# `cd <dir> && git commit ...`: the commit runs in <dir>, not in the session's cwd.
CD = re.compile(r"(?:^|[;&|]\s*)cd\s+(?:\"([^\"]+)\"|'([^']+)'|(\S+))\s*(?:&&|;)")
DIFF = ["diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "-U0"]


def run(args, cwd, stdin=None):
    return subprocess.run(args, cwd=cwd, input=stdin, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def main():
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        data = json.load(sys.stdin)
        command = data["tool_input"]["command"]
        cwd = data.get("cwd") or None
    except (ValueError, KeyError, TypeError):
        return 0
    match = COMMIT.search(command)
    if not match:
        return 0
    cds = CD.findall(command[: match.end()])
    if cds:
        target = os.path.expandvars(os.path.expanduser(next(g for g in cds[-1] if g)))
        candidate = target if Path(target).is_absolute() else str(Path(cwd or ".") / target)
        if Path(candidate).is_dir():
            cwd = candidate

    gate = [sys.executable, "-I", str(GATE)]
    stdin = None
    if ALL_FLAG.search(" " + match.group(1)):
        root = run(["git", "rev-parse", "--show-toplevel"], cwd)
        if root.returncode != 0:
            return 0
        stdin = run(["git", *DIFF, "--cached"], cwd).stdout + run(["git", *DIFF], cwd).stdout
        gate += ["--diff", "-", "--allow", str(Path(root.stdout.strip()) / ".git-commit-allow")]
    result = run(gate, cwd, stdin)
    if result.returncode == 4:
        print(f"Commit blocked by the secret gate.\n\n{result.stdout}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception as exc:  # fail open: a crash must not block the commit
        print(f"commit_guard: crashed ({type(exc).__name__}: {exc}); "
              "this commit was NOT scanned for secrets", file=sys.stderr)
        code = 1  # non-blocking error: Claude Code shows this stderr to the user
    sys.exit(code)
