"""Tests for the python-style audit and survey scripts."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "plugins" / "python-style" / "skills"
AUDIT = SKILLS / "audit" / "scripts" / "audit.py"
SURVEY = SKILLS / "survey" / "scripts" / "survey.py"


def audit(project: Path) -> list[dict]:
    r = subprocess.run(
        [sys.executable, str(AUDIT), str(project), "--json"],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(r.stdout)


def rules(findings: list[dict], level: str = "fix") -> set[str]:
    return {f["rule"] for f in findings if f["level"] == level}


def messages(findings: list[dict], rule: str) -> list[str]:
    return [f["msg"] for f in findings if f["rule"] == rule]


@pytest.fixture
def old_library(tmp_path: Path) -> Path:
    """A project in the pre-guide style: setuptools, black, isort, pip-tools."""
    (tmp_path / "pyproject.toml").write_text(
        '[build-system]\nrequires = ["setuptools >= 40.6.0", "wheel"]\n'
        '[project]\nname = "minchin.old"\ndynamic = ["version", "dependencies"]\n'
        "[tool.black]\nline-length = 120\n[tool.isort]\nprofile = 'black'\n",
        encoding="utf8",
    )
    (tmp_path / "setup.py").write_text("", encoding="utf8")
    (tmp_path / ".requirements").mkdir()
    (tmp_path / "test").mkdir()
    (tmp_path / "env").mkdir()
    (tmp_path / "License.txt").write_text("MIT", encoding="utf8")
    (tmp_path / "tasks.py").write_text("", encoding="utf8")
    (tmp_path / "minchin" / "old").mkdir(parents=True)
    (tmp_path / "minchin" / "__init__.py").write_text("", encoding="utf8")
    return tmp_path


@pytest.fixture
def tooling_repo(tmp_path: Path) -> Path:
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "x"\nversion = "0"\nrequires-python = ">=3.11"\n'
        '[tool.python-style]\nkind = "tooling"\n',
        encoding="utf8",
    )
    return tmp_path


def test_old_library_hits_the_expected_rules(old_library: Path) -> None:
    found = rules(audit(old_library))
    # F1 black/isort, F3 no ruff config, D2 pip-tools layering, D3 no
    # lockfile, P1 setup.py, P2 old setuptools, P3 requires-python, L1
    # namespace __init__, L3 top-level tests, L4 env/ and filename casing
    assert {"F1", "F3", "D2", "D3", "P1", "P2", "P3", "L1", "L3", "L4"} <= found


def test_wrong_filename_case_is_reported(old_library: Path) -> None:
    assert "License.txt should be LICENSE.txt" in messages(audit(old_library), "L4")


def test_dynamic_dependencies_are_reported(old_library: Path) -> None:
    assert any("dynamic" in m for m in messages(audit(old_library), "D2"))


def test_tooling_kind_skips_packaging_rules(tooling_repo: Path) -> None:
    found = rules(audit(tooling_repo))
    assert found.isdisjoint({"P1", "P2", "P4", "P5", "P6", "L1", "L3"})
    # but formatting, dependency and CI rules still apply
    assert {"F3", "D3", "A1"} <= found


def test_tooling_kind_needs_a_changelog_but_not_invoke_yaml(
    tooling_repo: Path,
) -> None:
    findings = audit(tooling_repo)
    assert any("changelog" in m for m in messages(findings, "L5"))
    assert not any("invoke.yaml" in m for m in messages(findings, "L4"))


def test_library_without_marker_needs_requires_python(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "x"\n', encoding="utf8")
    assert "P3" in rules(audit(tmp_path))


def test_changelog_may_live_in_docs(tooling_repo: Path) -> None:
    (tooling_repo / "docs").mkdir()
    (tooling_repo / "docs" / "changelog.rst").write_text("x", encoding="utf8")
    assert messages(audit(tooling_repo), "L5") == []


def test_changelog_in_both_places_and_stale_invoke_path(tooling_repo: Path) -> None:
    (tooling_repo / "docs").mkdir()
    (tooling_repo / "docs" / "Changelog.rst").write_text("x", encoding="utf8")
    (tooling_repo / "CHANGELOG.rst").write_text("x", encoding="utf8")
    (tooling_repo / "invoke.yaml").write_text(
        "releaser:\n  changelog: nope.rst\n", encoding="utf8"
    )
    found = " | ".join(messages(audit(tooling_repo), "L5"))
    assert "keep one" in found
    assert "should be docs/changelog.rst" in found
    assert "nope.rst does not exist" in found


def test_non_v_tags_are_flagged(tooling_repo: Path) -> None:
    subprocess.run(["git", "init", "-q", str(tooling_repo)], check=True)
    git = ["git", "-C", str(tooling_repo), "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "x"], check=True)
    for tag in ("1.0.0", "v2.0.0"):
        subprocess.run([*git, "tag", tag], check=True)
    flagged = messages(audit(tooling_repo), "L6")
    assert len(flagged) == 1
    assert "1.0.0" in flagged[0]
    assert "v2.0.0" not in flagged[0]


def test_survey_writes_a_report_and_skips_forks(tmp_path: Path) -> None:
    root = tmp_path / "root"
    for name, remote in (
        ("mine", "https://github.com/minchinweb/mine.git"),
        ("upstream", "https://github.com/someoneelse/upstream.git"),
    ):
        repo = root / name
        repo.mkdir(parents=True)
        (repo / "pyproject.toml").write_text('[project]\nname = "x"\n', encoding="utf8")
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        subprocess.run(
            ["git", "-C", str(repo), "remote", "add", "origin", remote], check=True
        )
    out = tmp_path / "out" / "DEVIATIONS.md"
    subprocess.run(
        [sys.executable, str(SURVEY), str(root), str(out)],
        capture_output=True,
        text=True,
        check=True,
    )
    text = out.read_text(encoding="utf8")
    assert "**mine**" in text
    assert "**upstream**" not in text
    assert "## Skipped" in text
    assert "upstream" in text.split("## Skipped")[1]
