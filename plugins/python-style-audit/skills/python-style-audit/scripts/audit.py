"""Mechanical checks of a Python project against python-style-guide/STYLE.md.

Usage: python audit.py PROJECT_DIR [--json]

Reports findings tagged with STYLE.md rule numbers. It only reads files; it
never changes anything. Judgement calls (library vs app, what to do about a
finding) are left to the caller.

Levels: "fix" = clear deviation, "check" = might be fine, look first,
"info" = informational.
"""

from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path

CANON_FILES = {  # lower-case name -> canonical name
    "readme.rst": "README.rst",
    "readme.md": "README.md",
    "changelog.rst": "CHANGELOG.rst",
    "license.txt": "LICENSE.txt",
    "license": "LICENSE.txt",
    "license.rst": "LICENSE.txt",
    "license.md": "LICENSE.txt",
    "tasks.py": "tasks.py",
    "invoke.yaml": "invoke.yaml",
    ".editorconfig": ".editorconfig",
    ".gitignore": ".gitignore",
    ".gitattributes": ".gitattributes",
}
REQUIRED_FILES = [
    "pyproject.toml",
    "tasks.py",
    "invoke.yaml",
    ".editorconfig",
    ".gitignore",
    ".gitattributes",
]
DEPRECATED_RUFF_TOP = {"select", "ignore", "fixable", "unfixable", "extend-select",
                       "per-file-ignores", "isort", "flake8-copyright"}
WANTED_RULES = set("A B E W I N PTH RUF SIM UP YTT".split())
SKIP_DIRS = {".venv", "env", "build", "dist", "node_modules", "_vendor",
             "migrations", "__pycache__", ".git"}


def main() -> int:
    root = Path(sys.argv[1]).resolve()
    findings: list[dict] = []

    def add(rule: str, msg: str, level: str = "fix") -> None:
        findings.append({"rule": rule, "level": level, "msg": msg})

    names = {p.name for p in root.iterdir()}
    pp_path = root / "pyproject.toml"
    pp: dict = {}
    pp_text = ""
    if pp_path.exists():
        pp_text = pp_path.read_text(encoding="utf8")
        try:
            pp = tomllib.loads(pp_text)
        except tomllib.TOMLDecodeError as e:
            add("P1", f"pyproject.toml does not parse: {e}")
    project, tool = pp.get("project", {}), pp.get("tool", {})

    # --- F: ruff ---------------------------------------------------------
    for t in ("black", "isort", "flake8"):
        if t in tool:
            add("F1", f"[tool.{t}] present; remove it (ruff replaces it)")
    all_deps = [d for d in project.get("dependencies", []) if isinstance(d, str)]
    for grp in list(pp.get("dependency-groups", {}).values()) + list(
        project.get("optional-dependencies", {}).values()
    ):
        all_deps += [d for d in grp if isinstance(d, str)]
    for d in all_deps:
        if re.match(r"(black|isort|flake8|flake8-pyproject)\b", d, re.I):
            add("F1", f"dependency {d!r}; ruff replaces it")
    ruff = tool.get("ruff")
    if ruff is None:
        add("F3", "no [tool.ruff] configuration")
    else:
        if ruff.get("line-length") != 88:
            add("F2", f"line-length is {ruff.get('line-length')!r}, want 88")
        for k in sorted(DEPRECATED_RUFF_TOP & ruff.keys()):
            add("F3", f"[tool.ruff] top-level {k!r} is deprecated; move under [tool.ruff.lint]")
        lint = ruff.get("lint", {})
        sel = set(lint.get("extend-select", [])) | set(lint.get("select", []))
        missing = WANTED_RULES - sel
        if missing:
            add("F3", f"rule families not selected: {' '.join(sorted(missing))}")
        if lint.get("future-annotations") is not True:
            add("F3", "lint.future-annotations is not true")
        iso = lint.get("isort", {})
        if iso.get("force-sort-within-sections") is not True:
            add("F4", "isort.force-sort-within-sections is not true")
        for s in ("django", "pelican"):
            if s not in iso.get("section-order", []) or s not in iso.get("sections", {}):
                add("F4", f"isort section {s!r} missing from section-order/sections")
        fmt = ruff.get("format", {})
        if fmt.get("line-ending") != "auto":
            add("F5", f"format.line-ending is {fmt.get('line-ending')!r}, want 'auto'")
        if fmt.get("docstring-code-format") is not True:
            add("F5", "format.docstring-code-format is not true")
        if ruff.get("force-exclude") is not True:
            add("F6", "force-exclude is not true")
    joined = " ".join(all_deps)
    for need in ("ruff", "taplo", "validate-pyproject", "invoke", "pytest"):
        if need not in joined:
            add("F9" if need in ("taplo", "validate-pyproject") else "D2",
                f"{need!r} not in any dependency group")

    # --- D: dependencies -------------------------------------------------
    dyn = set(project.get("dynamic", []))
    for k in ("dependencies", "optional-dependencies"):
        if k in dyn:
            add("D2", f"{k!r} is dynamic; make it static in pyproject.toml")
    if (root / ".requirements").exists():
        add("D2", ".requirements/ folder exists (pip-tools layering)")
    for f in sorted(names):
        if re.match(r"requirements.*\.(txt|in)$", f):
            add("D2", f"{f} at repo root; fold into pyproject.toml / uv.lock")
    if not (root / "uv.lock").exists():
        add("D3", "uv.lock missing")
    if "dependency-groups" not in pp:
        add("D2", "no [dependency-groups]")

    # --- P: pyproject ----------------------------------------------------
    for f in ("setup.py", "setup.cfg", "MANIFEST.in"):
        if f in names:
            add("P1", f"{f} present")
    reqs = " ".join(pp.get("build-system", {}).get("requires", []))
    m = re.search(r"setuptools\s*>=\s*(\d+)", reqs)
    if not m or int(m.group(1)) < 77:
        add("P2", f"build-system requires {reqs!r}; want setuptools >= 77")
    if "wheel" in reqs:
        add("P2", "'wheel' in build-system.requires is not needed")
    if isinstance(project.get("license"), dict):
        add("P2", "license is a table; use an SPDX string")
    if any(c.startswith("License ::") for c in project.get("classifiers", [])):
        add("P2", "'License ::' classifier present; the SPDX license replaces it")
    if "license-files" not in project:
        add("P2", "license-files missing")
    if not project.get("requires-python"):
        add("P3", "requires-python not set")
    extra_dyn = dyn - {"version", "readme"}
    if extra_dyn:
        add("P4", f"dynamic has extra fields: {sorted(extra_dyn)}")
    sdyn = tool.get("setuptools", {}).get("dynamic", {})
    if "version" in dyn and "attr" not in sdyn.get("version", {}):
        add("P4", "version is dynamic but not read via 'attr'")
    if "version" not in dyn and "version" in project:
        add("P4", f"static version {project['version']!r}; want dynamic via __version__", "check")
    if "Development Status" not in re.sub(r"(?m)^\s*[^#\s].*$", "", pp_text):
        add("P5", "commented classifier menu (Development Status) missing")
    urls = {k.lower() for k in project.get("urls", {})}
    for need in ("bug tracker", "repository", "changelog"):
        if need not in urls:
            add("P6", f"[project.urls] lacks {need!r}", "check")

    # --- L: layout -------------------------------------------------------
    if (root / "minchin").exists():
        if (root / "minchin" / "__init__.py").exists():
            add("L1", "minchin/__init__.py exists; the namespace must not have one")
        if not list((root / "minchin").glob("**/tests")):
            add("L3", "no minchin/<name>/tests/ directory", "check")
        tp = tool.get("pytest", {}).get("ini_options", {}).get("testpaths")
        if tp != ["minchin"]:
            add("L3", f"pytest testpaths is {tp!r}, want ['minchin']")
    for d in ("test", "tests"):
        if (root / d).is_dir():
            add("L3", f"top-level {d}/ exists; move into the package as tests/")
    if (root / "env").exists():
        add("L4", "env/ folder exists; use .venv/ only")
    gi = (root / ".gitignore").read_text(encoding="utf8", errors="ignore") if (root / ".gitignore").exists() else ""
    for need in (".venv", "dist", "build"):
        if need not in gi:
            add("L4", f".gitignore does not mention {need!r}", "check")
    present = {n.lower(): n for n in names}
    for low, canon in CANON_FILES.items():
        if low in present and present[low] != canon:
            add("L4", f"{present[low]} should be {canon}")
    if not any(n.lower().startswith("readme") for n in names):
        add("L4", "no README")
    if not any(n.lower().startswith("changelog") for n in names):
        add("L4", "no CHANGELOG.rst")
    if not any(n.lower().startswith(("license", "licence")) for n in names):
        add("L4", "no LICENSE.txt")
    for n in REQUIRED_FILES:
        if n.lower() not in present:
            add("L4", f"{n} missing")

    # --- A: CI -----------------------------------------------------------
    wf = root / ".github" / "workflows"
    for f, rule in (("check.yml", "A1"), ("test.yml", "A2")):
        if not (wf / f).exists():
            add(rule, f".github/workflows/{f} missing")
    if (root / ".pre-commit-config.yaml").exists():
        add("A3", ".pre-commit-config.yaml present; pre-commit is not used")
    if not any((root / ".github" / n).exists() for n in ("dependabot.yaml", "dependabot.yml")):
        add("A4", "no .github/dependabot.yaml", "check")

    # --- tasks.py --------------------------------------------------------
    tp = root / "tasks.py"
    if tp.exists():
        t = tp.read_text(encoding="utf8", errors="ignore")
        # tasks pulled in with `from x import *` can't be seen from here
        lvl = "check" if re.search(r"import \*", t) else "fix"
        for task in ("update", "upgrade", "lint", "test", "check"):
            if not re.search(rf"def {task}\(", t):
                add("D5" if task in ("update", "upgrade") else "F8", f"tasks.py has no {task!r} task", lvl)
        if not re.search(r"name=\"format\"|def format\(", t):
            add("F8", "tasks.py has no 'format' task", lvl)

    # --- C: code (informational) ----------------------------------------
    files = [
        p for p in root.rglob("*.py")
        if not any(part in SKIP_DIRS or part.endswith(".egg-info")
                   for part in p.relative_to(root).parts)
        and p.name not in {"setup.py", "tasks.py", "__init__.py"}
    ]
    no_future = [p for p in files
                 if "from __future__ import annotations" not in p.read_text(encoding="utf8", errors="ignore")]
    if files and no_future:
        add("C1", f"{len(no_future)} of {len(files)} modules lack "
                  "'from __future__ import annotations' (ruff --fix adds it)", "info")

    if "--json" in sys.argv:
        print(json.dumps(findings, indent=2))
    else:
        print(f"# {root.name}: {len(findings)} findings")
        for f in sorted(findings, key=lambda f: (f["rule"], f["msg"])):
            print(f"[{f['rule']}] ({f['level']}) {f['msg']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
