"""Tests for the claude-setup install-statusline script."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SKILL = (
    Path(__file__).resolve().parents[1]
    / "plugins"
    / "statusline"
    / "skills"
    / "install"
)

spec = importlib.util.spec_from_file_location(
    "install", SKILL / "scripts" / "install.py"
)
install_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install_mod)
install = install_mod.install


def settings(claude_dir: Path) -> dict:
    return json.loads((claude_dir / "settings.json").read_text(encoding="utf-8"))


def test_fresh_machine_installs_without_asking(tmp_path: Path) -> None:
    code, _ = install(tmp_path)
    assert code == 0
    assert settings(tmp_path)["statusLine"]["command"] == install_mod.COMMAND
    assert (tmp_path / "statusline.sh").read_bytes() == install_mod.SCRIPT.read_bytes()


def test_keeps_other_settings(tmp_path: Path) -> None:
    (tmp_path / "settings.json").write_text('{"theme": "auto"}', encoding="utf-8")
    install(tmp_path)
    assert settings(tmp_path)["theme"] == "auto"


def test_rerun_is_clean(tmp_path: Path) -> None:
    install(tmp_path)
    code, notes = install(tmp_path)
    assert code == 0
    assert not (tmp_path / "statusline.sh.bak").exists()
    assert len(notes) == 1


def test_other_status_line_is_not_overwritten(tmp_path: Path) -> None:
    other = {"type": "command", "command": "echo hi"}
    (tmp_path / "settings.json").write_text(
        json.dumps({"statusLine": other}), encoding="utf-8"
    )
    code, notes = install(tmp_path)
    assert code == 2
    assert "echo hi" in notes[0]
    assert settings(tmp_path)["statusLine"] == other
    assert not (tmp_path / "statusline.sh").exists()


def test_force_replaces_and_saves_the_old_one(tmp_path: Path) -> None:
    other = {"type": "command", "command": "echo hi"}
    (tmp_path / "settings.json").write_text(
        json.dumps({"statusLine": other}), encoding="utf-8"
    )
    code, _ = install(tmp_path, force=True)
    assert code == 0
    assert settings(tmp_path)["statusLine"]["command"] == install_mod.COMMAND
    saved = json.loads((tmp_path / "statusline.previous.json").read_text("utf-8"))
    assert saved == other


def test_edited_script_is_backed_up(tmp_path: Path) -> None:
    (tmp_path / "statusline.sh").write_text("# my edits\n", encoding="utf-8")
    code, notes = install(tmp_path)
    assert code == 0
    assert (tmp_path / "statusline.sh.bak").read_text("utf-8") == "# my edits\n"
    assert any("differed" in n for n in notes)


def test_invalid_settings_json_is_left_alone(tmp_path: Path) -> None:
    (tmp_path / "settings.json").write_text("{nope", encoding="utf-8")
    code, _ = install(tmp_path)
    assert code == 1
    assert (tmp_path / "settings.json").read_text("utf-8") == "{nope"


@pytest.mark.parametrize("name", ["statusline.sh"])
def test_bundled_script_has_lf_endings(name: str) -> None:
    assert b"\r" not in (SKILL / name).read_bytes()


@pytest.fixture
def newer_bundle(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Install the current script, then make the bundled one 'newer'."""
    claude = tmp_path / "claude"
    install(claude)
    newer = tmp_path / "statusline.sh"
    newer.write_bytes(install_mod.SCRIPT.read_bytes() + b"# v2\n")
    monkeypatch.setattr(install_mod, "SCRIPT", newer)
    return claude


def test_update_refreshes_an_unmodified_install(newer_bundle: Path) -> None:
    assert install_mod.update(newer_bundle) == []
    assert (newer_bundle / "statusline.sh").read_bytes().endswith(b"# v2\n")


def test_update_leaves_local_edits_and_warns(newer_bundle: Path) -> None:
    (newer_bundle / "statusline.sh").write_text("# mine\n", encoding="utf-8")
    warnings = install_mod.update(newer_bundle)
    assert warnings
    assert (newer_bundle / "statusline.sh").read_text("utf-8") == "# mine\n"


def test_update_without_a_record_does_not_overwrite(newer_bundle: Path) -> None:
    (newer_bundle / "statusline.sha256").unlink()
    assert install_mod.update(newer_bundle)
    assert not (newer_bundle / "statusline.sh").read_bytes().endswith(b"# v2\n")


def test_update_ignores_machines_without_our_status_line(tmp_path: Path) -> None:
    (tmp_path / "settings.json").write_text(
        '{"statusLine": {"type": "command", "command": "echo hi"}}', encoding="utf-8"
    )
    assert install_mod.update(tmp_path) == []
    assert not (tmp_path / "statusline.sh").exists()
    assert install_mod.update(tmp_path / "empty") == []
