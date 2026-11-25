import json
import os
import subprocess
import sys
import tempfile
import unittest

HOOKS = os.path.join(os.path.dirname(__file__), "..", "hooks")
sys.path.insert(0, HOOKS)

import stamps  # noqa: E402

PROMPT = "fix the login bug"
ANSWER = "Both are done.\n\n- **Agent Monitor** is pushed"


def line(kind, stamp, content, message_id=None):
    entry = {"type": kind, "timestamp": stamp, "uuid": stamp, "message": {"role": kind, "content": content}}
    if message_id:
        entry["message"]["id"] = message_id
    return json.dumps(entry)


class ReadStamps(unittest.TestCase):
    def write(self, lines):
        handle, path = tempfile.mkstemp(suffix=".jsonl")
        with os.fdopen(handle, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        self.addCleanup(os.remove, path)
        return path

    def test_prompt_stamp_is_the_entry_timestamp(self):
        path = self.write([line("user", "2026-11-25T15:51:27.786Z", PROMPT)])
        found, _ = stamps.read_stamps(path)
        self.assertEqual(found[PROMPT], stamps.epoch_ms("2026-11-25T15:51:27.786Z"))

    def test_answer_split_over_lines_is_joined_and_stamped_with_its_last_line(self):
        path = self.write([
            line("assistant", "2026-11-25T15:52:00.000Z", [{"type": "text", "text": "Both are done."}], "m1"),
            line("assistant", "2026-11-25T15:52:05.000Z", [{"type": "text", "text": "- **Agent Monitor** is pushed"}], "m1"),
        ])
        found, last = stamps.read_stamps(path)
        self.assertEqual(found[ANSWER], stamps.epoch_ms("2026-11-25T15:52:05.000Z"))
        self.assertEqual(last, stamps.epoch_ms("2026-11-25T15:52:05.000Z"))

    def test_last_is_the_last_assistant_message_not_a_tool_result(self):
        path = self.write([
            line("user", "2026-11-25T15:51:00.000Z", PROMPT),
            line("assistant", "2026-11-25T15:51:30.000Z", [{"type": "text", "text": "Reading."}], "m1"),
            line("user", "2026-11-25T15:51:40.000Z", [{"type": "tool_result", "content": "ok"}]),
        ])
        _, last = stamps.read_stamps(path)
        self.assertEqual(last, stamps.epoch_ms("2026-11-25T15:51:30.000Z"))

    def test_lines_that_are_not_json_are_skipped(self):
        path = self.write(["not json", line("user", "2026-11-25T15:51:27.786Z", PROMPT)])
        found, _ = stamps.read_stamps(path)
        self.assertIn(PROMPT, found)

    def test_empty_file_has_no_last(self):
        path = self.write([])
        self.assertEqual(stamps.read_stamps(path), ({}, None))


class Command(unittest.TestCase):
    def test_reply_has_only_the_requested_texts(self):
        handle, path = tempfile.mkstemp(suffix=".jsonl")
        with os.fdopen(handle, "w", encoding="utf-8") as f:
            f.write(line("user", "2026-11-25T15:51:27.786Z", PROMPT) + "\n")
        self.addCleanup(os.remove, path)
        request = json.dumps({"texts": [PROMPT, "never sent"]})
        out = subprocess.run(
            [sys.executable, os.path.join(HOOKS, "stamps.py"), path],
            input=request, capture_output=True, text=True, check=True,
        )
        self.assertEqual(json.loads(out.stdout), {"stamps": {PROMPT: stamps.epoch_ms("2026-11-25T15:51:27.786Z")}, "last": None})


if __name__ == "__main__":
    unittest.main()
