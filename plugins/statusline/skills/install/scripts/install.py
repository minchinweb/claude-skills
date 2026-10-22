"""Install the bundled status line into ~/.claude and point settings.json at it.

Exit codes: 0 installed or updated, 1 error, 2 a different status line is already
configured (nothing changed; re-run with --force to replace it).

`--update` is for the SessionStart hook: it only refreshes an installed copy that
is still exactly what this script last wrote, and otherwise does nothing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

SCRIPT = Path(__file__).resolve().parents[1] / "statusline.sh"
NAME = "statusline.sh"
COMMAND = f"bash ~/.claude/{NAME}"
PREVIOUS = "statusline.previous.json"
RECORD = "statusline.sha256"  # hash of the copy we last installed


def is_ours(status_line: object) -> bool:
    """True if the configured status line already runs our script."""
    return isinstance(status_line, dict) and NAME in str(status_line.get("command", ""))


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def update(claude_dir: Path) -> list[str]:
    """Quietly refresh an unmodified installed copy; returns warnings, if any."""
    target = claude_dir / NAME
    record = claude_dir / RECORD
    settings_path = claude_dir / "settings.json"
    try:
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not is_ours(settings.get("statusLine")) or not target.exists():
        return []  # never installed by us: not ours to touch

    bundled = SCRIPT.read_bytes()
    installed = target.read_bytes()
    if installed == bundled:
        record.write_text(digest(bundled), encoding="utf-8")
        return []
    last = record.read_text(encoding="utf-8").strip() if record.exists() else ""
    if digest(installed) != last:
        msg = f"A newer status line is available, but {target} has local changes "
        return [
            msg + "(or predates auto-update). Run /statusline:install to review it."
        ]
    target.write_bytes(bundled)
    record.write_text(digest(bundled), encoding="utf-8")
    return []


def install(claude_dir: Path, *, force: bool = False) -> tuple[int, list[str]]:
    """Install into `claude_dir`; returns (exit code, lines to show the user)."""
    settings_path = claude_dir / "settings.json"
    settings: dict = {}
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            return 1, [f"{settings_path} is not valid JSON ({e}); fix it first."]

    current = settings.get("statusLine")
    notes: list[str] = []

    if current is not None and not is_ours(current):
        shown = json.dumps(current, ensure_ascii=False)
        if not force:
            saved = claude_dir / PREVIOUS
            return 2, [
                f"A different status line is already configured: {shown}",
                f"Nothing was changed. Re-run with --force to replace it ({saved}).",
            ]
        claude_dir.mkdir(parents=True, exist_ok=True)
        (claude_dir / PREVIOUS).write_text(
            json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        notes.append(f"Replaced the previous status line (saved as {PREVIOUS}).")

    target = claude_dir / NAME
    claude_dir.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.read_bytes() != SCRIPT.read_bytes():
        backup = target.with_suffix(".sh.bak")
        shutil.copy2(target, backup)
        notes.append(
            f"{NAME} differed from the bundled one; old copy kept as {backup.name}."
        )
    shutil.copyfile(SCRIPT, target)
    (claude_dir / RECORD).write_text(digest(SCRIPT.read_bytes()), encoding="utf-8")

    settings["statusLine"] = {"type": "command", "command": COMMAND}
    settings_path.write_text(
        json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    notes.insert(0, f"Installed {target} and set statusLine in {settings_path}.")
    return 0, notes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--claude-dir", type=Path, default=Path.home() / ".claude")
    parser.add_argument(
        "--force", action="store_true", help="replace a different status line"
    )
    parser.add_argument(
        "--update", action="store_true", help="refresh an unmodified install quietly"
    )
    args = parser.parse_args()
    if args.update:
        if warnings := update(args.claude_dir):
            print(json.dumps({"systemMessage": " ".join(warnings)}))
        return 0
    code, lines = install(args.claude_dir, force=args.force)
    print("\n".join(lines), file=sys.stderr if code else sys.stdout)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
