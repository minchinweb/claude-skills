# Readable Layout (plain)

A fork of [readable-layout](https://github.com/GarvitNangru/claude-code-mods/tree/main/mods/readable-layout) by Garvit Nangru (MIT). The change: no side bars. Your messages and Claude's answers sit between full-width top and bottom rules with the label on the top rule, so copying text from the terminal picks up no box edges. Bold, quiet notes and the end-of-turn rule work as in the original.

Three additions to the original: the end-of-turn rule and the top rules of your message and Claude's answer boxes show the clock time at the right, and the plugin watches the prompt cache. An hour after the last turn (a subscription's cache lifetime) it adds a `✻ Prompt cache expired at …` rule to the transcript if the session is still open, and `/cache-age` shows when the last turn ended and when the cache expires.

The `keepwarm` option (off by default) sends a one-word refresh 50 minutes after each turn, up to three times, using a fork over the session's transcript, the same call cache-tax uses. Each reply's usage says whether the cache was still warm: a warm reply pushes the expiry an hour on, and a cold one prints the expiry rule at once. Each refresh costs tokens, and a refresh that finds the cache cold rewrites it, so leave this off for short sessions. With it off, the rule is only an estimate from the last turn.

Times for a resumed session come from its transcript file. `hooks/stamps.py` reads that file line by line, so a long session is no problem, and the plugin runs it with `python`, `python3` or `py -3`. Without Python, or when the file cannot be read, the times fall back to this session's own turns.

Each refresh, from `keepwarm` or `/keepalive`, first prints a quiet status line, `✻ Keeping the prompt cache warm at 10:50 AM`, so you can see it run.

`/keepalive` runs the same refresh through a window of time: `/keepalive 60` (minutes) or `/keepalive 5h` or `/keepalive 2h30m`. It refreshes 50 minutes after the last warm moment, every 50 minutes after that, and once more at the end of the window. `/keepalive off` stops it, and `/keepalive` alone shows whether it is running. `/cache-age` also shows the keepalive state and the context size. Before it starts, it reads the last turn (from this session, or else the transcript file's last write). If that was more than an hour ago the cache has lapsed, so it warns and does not start, because a refresh would then rewrite the whole context.

Only the **final answer** of each turn gets the Claude box. The text Claude writes between tool calls ("Checking the config first", or a longer plan) is an indented note in the normal text color, not dimmed, so it stays readable without looking like the answer. The plugin learns which text was the answer when the turn ends, so the answer is drawn as a note while it streams in and gets its box the moment the turn finishes. For earlier turns, such as a resumed session's, it reads the session's transcript: each turn's answer is the text Claude wrote after its last tool call. Nothing is stored outside the transcript.

GitHub alert blocks draw as **callouts**: a colored rule with the label, the body, and a closing rule, indented and with no side bars.

```
> [!WARNING]
> The token expires on Friday.
```

`NOTE` is blue, `TIP` green, `IMPORTANT` purple, `WARNING` yellow and `CAUTION` red. They work in answers and notes alike, and markers inside code fences are left alone. Callouts and the final-answer box were borrowed as ideas from [prismantis](https://github.com/NahumLitvin/prismantis) (MIT), which draws alerts the same way and tells the model what the terminal can draw.

The `calloutHint` option (on by default) does the second part: once per conversation it adds a short note (about 120 tokens) telling Claude that its final answer is boxed and that callouts are there for what you need to know or act on, at most one or two per reply. Set it to `off` to leave the note out.

The other settings are the same: `boxes` (`answers` boxes only the final answer, `all` boxes everything) and `bold` (`color`, `highlight` or `off`). Config key is `readable-layout-plain`.

---

# Readable Layout

In the terminal, a Claude Code session is one long stream. Your message, Claude's short notes ("I'll check the config first"), its tool calls and its final answer all start with the same bullet in the same style. That makes it hard to tell who is talking, what Claude is doing, and which part is the answer you need to read.

Readable Layout gives every part of a turn its own look. Here is the same conversation in stock Claude Code and with the mod, both with the [Ember](../../skins/ember) skin:

**Before**

![The conversation in stock Claude Code: the prompt, Claude's notes and its answer all start with the same white dot, and the bold names look like normal text](../../docs/screenshots/readable-layout-before.png)

**After**

![The same conversation with Readable Layout: the prompt and the answer sit in boxes labeled You and Claude, the notes are quiet grey lines, the bold names are teal, and a rule ends the turn](../../docs/screenshots/readable-layout-after.png)

## What changes

- **Your messages** sit in a box labeled **You**, in your theme's blue.
- **Claude's answers** sit in a box labeled **Claude**, in Claude's orange. Anything longer than a line or two counts as an answer. Inside the box it renders as before: headings, lists, tables, code blocks and links.
- **Bold text stands out.** Claude Code draws bold text in the same color as everything else, only thicker, and at terminal font sizes that is easy to miss. Readable Layout draws it bold and in a soft teal, so key words and the lead-in of each list item catch your eye. Teal sits opposite Claude's orange on the color wheel, so bold text never blends into the orange boxes and labels, and inline `code` keeps its own blue.
- **Claude's short notes** between steps become quiet, indented lines with a blank line above each one, so every note sits with the step it describes.
- **Tool activity** ("Read 1 file", "Searched for 1 pattern") keeps Claude Code's own quiet style, so you can skim past it.
- **Each turn ends with a rule** across the screen that shows how long it took, so you can see where one exchange stops and the next begins.

Notifications from background tasks, messages from other agents, permission prompts, diffs and command output are left exactly as Claude Code draws them.

## Installing

Type this at the Claude Code prompt:

```
/plugin install readable-layout --marketplace GarvitNangru/claude-code-mods
```

It asks whether to add this repo as a marketplace. Say `y` and pick a scope; the user scope loads it in every session. It starts working right away, no restart needed.

To update it later, run `claude plugin update readable-layout@garvit-mods`, then `/reload-plugins` in an open session. To remove it, run `/plugin uninstall readable-layout@garvit-mods`. To run it from a clone instead, see [Trying one from a clone](../../README.md#trying-one-from-a-clone).

## Settings

`Claude text to box` in `/config` has two choices:

- `answers` (the default) boxes replies of more than a line or two and shows one-line notes as quiet lines.
- `all` boxes everything Claude writes, notes included.

`Bold text` has three:

- `color` (the default) draws bold text in your theme's cyan: a soft teal in Ember, verdigris in Firelight, a deeper cyan in Claude Code's own dark and light themes.
- `highlight` puts a soft background behind bold text, like a marker pen, if you'd rather keep the text color unchanged.
- `off` leaves bold text exactly as Claude Code draws it.

For a mod loaded from a folder, set them in `~/.claude/settings.json` instead:

```json
{ "pluginConfigs": { "readable-layout": { "options": { "boxes": "all", "bold": "highlight" } } } }
```

## Good to know

- Only the terminal changes. The desktop app, VS Code and mobile already lay a conversation out on their own, so they're left alone.
- The box and rule colors come from your theme, so they match whatever theme you use. It's designed alongside the [Ember](../../skins/ember) skin.
- To color bold text, the mod draws the paragraphs, headings and lists that contain it itself. Everything else is still drawn by Claude Code: code blocks, tables, quotes, and any part of a reply without bold. Bold text inside a table or a quote stays plain bold.
- It only changes how the transcript is drawn. What you and Claude wrote, and what's saved, stay exactly the same. Ctrl+O still shows the full transcript.

## Development

```
claude plugin validate mods/readable-layout
claude plugin test mods/readable-layout
```
