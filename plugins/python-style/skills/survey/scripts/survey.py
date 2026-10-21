"""Survey many Python projects against the style guide and write DEVIATIONS.md.

Usage: python survey.py ROOT OUT_FILE [--include-forks] [--owner NAME]

Runs ../../audit/scripts/audit.py on every direct subfolder of ROOT that is a
git repo with Python packaging files. Repos whose `origin` belongs to someone
other than OWNER (default: minchinweb) are skipped as forks/upstreams unless
--include-forks is given.

The output names your local projects, so it is meant to stay on this machine:
OUT_FILE should not be inside a published repo.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date
import json
from pathlib import Path
import re
import subprocess
import sys

AUDIT = Path(__file__).resolve().parents[2] / "audit" / "scripts" / "audit.py"
PY_MARKERS = ("pyproject.toml", "setup.py", "setup.cfg")


def origin_owner(repo: Path) -> str | None:
    """The GitHub owner of ``origin``, or None if there is no remote."""
    r = subprocess.run(
        ["git", "-C", str(repo), "remote", "get-url", "origin"],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        return None
    m = re.search(r"[:/]([^/:]+)/[^/]+?(?:\.git)?$", r.stdout.strip())
    return m.group(1).lower() if m else ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--include-forks", action="store_true")
    ap.add_argument("--owner", default="minchinweb")
    a = ap.parse_args()

    results: dict[str, list[dict]] = {}
    skipped: list[str] = []
    for d in sorted(a.root.iterdir()):
        if not (d / ".git").exists() or not any((d / m).exists() for m in PY_MARKERS):
            continue
        owner = origin_owner(d)
        if owner not in (None, a.owner.lower()) and not a.include_forks:
            skipped.append(d.name)
            continue
        r = subprocess.run(
            [sys.executable, str(AUDIT), str(d), "--json"],
            capture_output=True,
            text=True,
            check=False,
        )
        if r.returncode != 0:
            err = r.stderr.strip()[-200:]
            print(f"audit failed for {d.name}: {err}", file=sys.stderr)
            continue
        results[d.name] = json.loads(r.stdout)

    by_rule: dict[str, list[str]] = defaultdict(list)
    for repo, fs in results.items():
        for rule in sorted({f["rule"] for f in fs if f["level"] == "fix"}):
            by_rule[rule].append(repo)

    lines = [
        "# Deviations from the guide",
        "",
        f"Generated {date.today()} from `{a.root}` by the `python-style:survey` skill.",
        "Local only: this names your projects. Regenerate rather than edit.",
        "",
        f"{len(results)} projects audited"
        + (f"; {len(skipped)} skipped as forks/upstream" if skipped else "")
        + ". Rule numbers are from `STYLE.md`; only clear deviations (`fix`) "
        "are counted.",
        "",
        "## By rule",
        "",
        "| Rule | Projects | Which |",
        "| --- | --- | --- |",
    ]
    for rule in sorted(by_rule):
        repos = by_rule[rule]
        lines.append(f"| {rule} | {len(repos)} | {', '.join(repos)} |")
    lines += ["", "## By project", ""]

    def n_fix(item: tuple[str, list[dict]]) -> int:
        return sum(f["level"] == "fix" for f in item[1])

    for repo, fs in sorted(results.items(), key=lambda kv: -n_fix(kv)):
        fix = [f for f in fs if f["level"] == "fix"]
        check = sum(f["level"] == "check" for f in fs)
        rules = " ".join(sorted({f["rule"] for f in fix})) or "clean"
        lines.append(f"- **{repo}**: {len(fix)} fix, {check} check -- {rules}")
    if skipped:
        lines += ["", "## Skipped (forks / upstream)", "", ", ".join(skipped)]
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text("\n".join(lines) + "\n", encoding="utf8")
    print(f"wrote {a.out} ({len(results)} projects, {len(skipped)} skipped)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
