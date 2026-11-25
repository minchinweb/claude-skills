"""Find when prompts and answers in a session transcript were written.

Usage: python stamps.py TRANSCRIPT < request.json

The request is {"texts": [...]}. The transcript is the session's .jsonl file. It is
read line by line, so its size does not matter. The reply, on standard output, is
{"stamps": {text: epoch_ms}, "last": epoch_ms or null}: a stamp for each requested
text that the transcript holds, and the time of its last assistant message, which is
when the last turn ended.
"""

from datetime import datetime
import json
import sys


def norm(text):
    return text.replace("\r\n", "\n").strip()


def epoch_ms(stamp):
    return int(datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000)


def text_of(content):
    """The text of a message's content, as a string or a list of blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n\n".join(
            b.get("text", "")
            for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def read_stamps(path):
    """Returns (stamps, last). An assistant message is split over several lines, one
    block each, so its lines are joined by message id and stamped with the last one."""
    prompts = {}
    answers = {}  # message id -> [parts, stamp]
    last = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            kind = entry.get("type")
            stamp = entry.get("timestamp")
            if kind not in ("user", "assistant") or not stamp:
                continue
            ms = epoch_ms(stamp)
            message = entry.get("message") or {}
            if kind == "user":
                text = norm(text_of(message.get("content")))
                if text:
                    prompts[text] = ms
            else:
                last = ms
                text = norm(text_of(message.get("content")))
                key = message.get("id") or entry.get("uuid")
                slot = answers.setdefault(key, [[], ms])
                if text:
                    slot[0].append(text)
                slot[1] = ms
    stamps = dict(prompts)
    for parts, ms in answers.values():
        if parts:
            stamps[norm("\n\n".join(parts))] = ms
    return stamps, last


def main():
    texts = {
        norm(t) for t in json.load(sys.stdin).get("texts", []) if isinstance(t, str)
    }
    stamps, last = read_stamps(sys.argv[1])
    found = {t: stamps[t] for t in texts if t in stamps}
    json.dump({"stamps": found, "last": last}, sys.stdout)


if __name__ == "__main__":
    main()
