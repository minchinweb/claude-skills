#!/usr/bin/env python3
"""Lint one commit message against MinchinWeb's commit style (see SKILL.md).

The style: a subject that starts with the robot emoji, says what the change
does in the imperative, is about 50 characters (72 at most) and has no trailing
full stop. A body is optional: it is for the why, or for a commit that does
several things.

  EMPTY             no subject                                              BLOCKER
  EMOJI_PREFIX      subject does not start with the robot emoji and a space  BLOCKER
  NO_BLANK_LINE     line 2 is not blank, so tools merge it into the subject  BLOCKER
  SUBJECT_TOO_LONG  subject over 72 characters                               BLOCKER
  VAGUE_SUBJECT     "fix", "update", "wip", "address review comments"...     BLOCKER
  SUBJECT_LONG      subject over 50 characters                               WARN
  NOT_IMPERATIVE    "Added", "Fixes", "Updating" instead of "Add", "Fix"     WARN
  TRAILING_PERIOD   subject ends with a full stop                            WARN
  BODY_MISSING      a change of --body-lines lines or --body-files files
                    or more with no body                                     WARN
  BODY_LISTS_FILES  the body is only file names: the diff already says that  WARN
  BODY_LINE_LONG    body line over 72 characters (URLs, code, trailers exempt) WARN
  FIXUP_PENDING     fixup!/squash!/amend! or WIP left in                     WARN

A "scope: " after the emoji ("🤖 statusline: show reset day") is fine; the
imperative and vague-subject checks look at the words after it.

Derived from commit-craft's message_linter.py (MIT, see NOTICE.md). Changes from
upstream: the emoji prefix is required and stripped before the subject checks;
the Conventional Commits, series (--range) and why/breaking heuristics are gone;
a missing body is a warning, not a blocker.
Deterministic, stdlib only, no network.
"""
import argparse
import json
import re
import subprocess
import sys

EXIT = {"CLEAN": 0, "FINDINGS": 2, "BAD_INPUT": 3, "BLOCKED": 4}
BLOCKER, WARN = "BLOCKER", "WARN"
PREFIX = "\N{ROBOT FACE} "
SCOPE = re.compile(r"^[\w./-]+(?:\([^()]*\))?: ")
VAGUE = {"fix", "fixes", "fixed", "bugfix", "fix bug", "fix bugs", "fix stuff", "fix tests", "fix test", "small fix",
         "minor fix", "update", "updates", "updated", "wip", "changes", "change", "misc", "stuff", "cleanup",
         "clean up", "tweaks", "tweak", "minor", "minor changes", "more", "again", "final", "final fix", "test",
         "testing", "asdf", "temp", "tmp", "refactor", "refactoring", "improvements", "address review comments",
         "address comments", "address feedback", "review comments", "pr feedback", "code review", "lint", "oops",
         "typo", "save", "commit", "done", "work", "progress"}
NON_IMPERATIVE = {
    "added", "adds", "adding", "fixed", "fixes", "fixing", "updated", "updates", "updating", "changed", "changes",
    "changing", "removed", "removes", "removing", "refactored", "refactors", "refactoring", "improved", "improves",
    "improving", "implemented", "implements", "implementing", "created", "creates", "creating", "deleted",
    "deletes", "deleting", "moved", "moves", "moving", "renamed", "renames", "renaming", "bumped", "bumps",
    "bumping", "upgraded", "upgrades", "upgrading", "merged", "merges", "merging", "cleaned", "cleans",
    "cleaning", "introduced", "introduces", "introducing", "replaced", "replaces", "replacing", "converted",
    "converts", "converting", "enabled", "enables", "enabling", "disabled", "disables", "disabling",
    "made", "makes", "making", "used", "uses", "using", "allowed", "allows", "allowing", "handled", "handles",
    "handling", "prevented", "prevents", "preventing", "reverted", "reverts", "reverting", "simplified",
    "simplifies", "simplifying", "extracted", "extracts", "extracting", "documented", "documents",
    "documenting", "tested", "tests", "ensured", "ensures", "ensuring", "supported", "supports", "supporting"}
TRAILER = re.compile(r"^[A-Za-z][\w-]*: \S|^[A-Za-z][\w-]* #\d+")
PATHLIKE = re.compile(r"^\s*[-*]?\s*`?[\w./-]+\.(\w{1,5})`?\s*:?\s*$|^\s*[-*]\s*(?:update|change|modify|edit)d?\s+`?[\w./-]+`?\s*$", re.I)
SCISSORS = "# ------------------------ >8 ------------------------"
EXEMPT_BODY = re.compile(r"^(Merge |Revert \"|revert|bump |style|chore\((?:deps|release)\)|build\(deps\)|ci|docs|test)", re.I)


def clean(message):
    if SCISSORS in message:
        message = message.split(SCISSORS)[0]
    lines = [l.rstrip() for l in message.splitlines() if not l.startswith("#")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def lint_message(message, lines_changed=None, files_changed=None, body_lines=40, body_files=4):
    out = []
    add = lambda code, sev, detail: out.append({"code": code, "severity": sev, "detail": detail})
    lines = clean(message)
    if not lines:
        add("EMPTY", BLOCKER, "no subject line")
        return out
    subject = lines[0].strip()
    body = lines[2:] if len(lines) > 2 else []
    if len(lines) > 1 and lines[1].strip():
        add("NO_BLANK_LINE", BLOCKER, "put a blank line between the subject and the body")
        body = lines[1:]
    if re.match(r"(?i)^(fixup|squash|amend)! |^wip\b|^\[wip\]", subject):
        add("FIXUP_PENDING", WARN, "fine locally; squash it before pushing")
        return out
    if subject.startswith(PREFIX) and subject[len(PREFIX):].strip():
        rest = subject[len(PREFIX):].strip()
    else:
        add("EMOJI_PREFIX", BLOCKER, f"start the subject with '{PREFIX}', e.g. '{PREFIX}Fix typo in README'")
        rest = subject
    desc = SCOPE.sub("", rest, count=1).strip()
    if len(subject) > 72:
        add("SUBJECT_TOO_LONG", BLOCKER, f"{len(subject)} chars; 72 is the limit, 50 the target")
    elif len(subject) > 50:
        add("SUBJECT_LONG", WARN, f"{len(subject)} chars; 50 is the target, 72 the limit")
    if desc.lower().rstrip(".!") in VAGUE or rest.lower().rstrip(".!") in VAGUE:
        add("VAGUE_SUBJECT", BLOCKER, f"'{rest}' says nothing a reviewer or bisect can use; say what the change does")
    first = re.split(r"\s+", desc)[0].lower().strip(":,") if desc else ""
    if first in NON_IMPERATIVE:
        add("NOT_IMPERATIVE", WARN, f"'{first}': write it as a command ('Fix', 'Add')")
    if subject.endswith(".") and not subject.endswith("..."):
        add("TRAILING_PERIOD", WARN, "drop the full stop at the end of the subject")
    text_body = [l for l in body if l.strip() and not TRAILER.match(l.strip())]
    big = (lines_changed or 0) >= body_lines or (files_changed or 0) >= body_files
    if not text_body:
        if big and not EXEMPT_BODY.match(desc):
            add("BODY_MISSING", WARN, f"{lines_changed} lines in {files_changed} files with no body: "
                                      "if it does several things or the why isn't obvious, say so")
    else:
        if all(PATHLIKE.match(l) for l in text_body):
            add("BODY_LISTS_FILES", WARN, "the body only lists files; the diff already shows them. Say why instead")
        for l in body:
            if len(l) > 72 and not re.search(r"https?://", l) and not l.startswith(("    ", "\t")) and not TRAILER.match(l):
                add("BODY_LINE_LONG", WARN, f"{len(l)}-char body line; wrap at 72")
                break
    return out


def git(args):
    proc = subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"git {' '.join(args)} failed")
    return proc.stdout


def staged_size():
    lines = files = 0
    for row in git(["diff", "--cached", "--numstat"]).splitlines():
        parts = row.split("\t")
        if len(parts) == 3:
            files += 1
            lines += sum(int(x) for x in parts[:2] if x.isdigit())
    return lines, files


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 epilog="Exit codes: 0 clean · 2 warnings only · 3 bad input · 4 blocked",
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--message-file", help="message file (a commit-msg hook passes .git/COMMIT_EDITMSG)")
    src.add_argument("-m", "--message", help="message text")
    ap.add_argument("--staged", action="store_true", help="size the change from the index (for BODY_MISSING)")
    ap.add_argument("--lines", type=int, help="changed lines of this commit, if known")
    ap.add_argument("--files", type=int, help="changed files of this commit, if known")
    ap.add_argument("--body-lines", type=int, default=40, help="warn about a missing body from this many changed lines (default 40)")
    ap.add_argument("--body-files", type=int, default=4, help="... or from this many changed files (default 4)")
    ap.add_argument("--output", choices=["text", "json"], default="text")
    a = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

    try:
        if a.message_file:
            with open(a.message_file, encoding="utf-8", errors="replace") as fh:
                message = fh.read()
        else:
            message = a.message
        lines, files = staged_size() if a.staged else (a.lines, a.files)
    except (OSError, RuntimeError) as exc:
        print(f"BAD_INPUT: {exc}", file=sys.stderr)
        return EXIT["BAD_INPUT"]

    findings = lint_message(message, lines, files, a.body_lines, a.body_files)
    blockers = sum(f["severity"] == BLOCKER for f in findings)
    verdict = "BLOCKED" if blockers else ("FINDINGS" if findings else "CLEAN")
    if a.output == "json":
        print(json.dumps({"verdict": verdict, "blockers": blockers, "warnings": len(findings) - blockers,
                          "findings": findings}, indent=2, ensure_ascii=False))
    else:
        print(f"{verdict}: {blockers} blocking, {len(findings) - blockers} warnings")
        for f in findings:
            print(f"  {f['severity']:7} {f['code']:17} {f['detail']}")
    return EXIT[verdict]


if __name__ == "__main__":
    sys.exit(main())
