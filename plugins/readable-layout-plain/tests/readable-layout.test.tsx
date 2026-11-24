import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, PromptOrigin, SessionMessage } from 'claude-code'

const ANSWER = 'Both are done.\n\n- **Agent Monitor** is pushed\n- **Ember** is applied'
const PLAIN_ANSWER = 'Both are done.\n\n- Agent Monitor is pushed\n- Ember is applied'
const NOTE = 'Checking the config first:'
const ACCENT = { bold: true, color: 'cyan_FOR_SUBAGENTS_ONLY' }
const PLUGIN = 'readable-layout'

function engineBeneath(on: On, transcript: SessionMessage[] = []): void {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine: {e.props.text}</Text>
  })
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine: {e.props.text}</Text>
  })
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine: {e.props.word}</Text>
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.context', (_$, e) => ({ blocks: e.blocks }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: transcript }))
}

const mountReply = ($: Engine, surface: 'terminal' | 'desktop', text: string, isSummary?: true) =>
  $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true, ...(isSummary ? { isSummary } : {}) },
  })

// Ends a turn with `text` as its answer, then draws it, as the transcript does.
const mountAnswer = async ($: Engine, text: string, columns?: number) => {
  await $.turn.complete({ ...TURN, answer: text })
  return $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    ...(columns ? { viewport: { columns, rows: 30 } } : {}),
  })
}

const mountPrompt = ($: Engine, surface: 'terminal' | 'desktop', text: string, origin: PromptOrigin = { kind: 'composer' }) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'UserMessage', props: { text, origin, isExpanded: true } })

const fromEngine = { type: 'Text', text: 'engine:' } as const

describe('your messages', () => {
  test('sit in a box labeled You', async ($, on) => {
    engineBeneath(on)
    const ui = await mountPrompt($, 'terminal', '  fix the login bug  ')
    expect((await ui.find({ type: 'Text', text: /── You/ }))?.props).toMatchObject({ color: 'suggestion' })
    expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle)).toBe(false)
    expect((await ui.find({ type: 'Text', text: 'login' }))?.text).toBe('fix the login bug')
    expect(await ui.find(fromEngine)).toBeUndefined()
  })

  test('leave notifications, other senders and other surfaces to the engine', async ($, on) => {
    engineBeneath(on)
    const mounts = [
      await mountPrompt($, 'terminal', 'Build finished', { kind: 'task-notification' }),
      await mountPrompt($, 'desktop', 'fix the login bug'),
    ]
    for (const ui of mounts) expect(await ui.find(fromEngine)).toBeDefined()
  })
})

describe("Claude's text", () => {
  test("the turn's final answer sits in a box labeled Claude, rendered as markdown", async ($, on) => {
    engineBeneath(on)
    const ui = await mountAnswer($, PLAIN_ANSWER)
    expect((await ui.find({ type: 'Text', text: /── Claude/ }))?.props).toMatchObject({ color: 'claude' })
    expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle)).toBe(false)
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe(PLAIN_ANSWER)
  })

  test('text between tool calls is an indented note in the normal text color', async ($, on) => {
    engineBeneath(on)
    const ui = await mountReply($, 'terminal', NOTE)
    expect((await ui.find({ type: 'Box' }))?.props).toMatchObject({ marginTop: 1, paddingLeft: 2 })
    expect((await ui.find({ type: 'Markdown' }))?.props).toEqual({ text: NOTE })
    expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle)).toBe(false)
  })

  test('long text that is not the final answer is a note too, not a box', async ($, on) => {
    engineBeneath(on)
    await $.turn.complete({ ...TURN, answer: 'Something else entirely, the real answer.' })
    const ui = await mountReply($, 'terminal', PLAIN_ANSWER)
    expect(await ui.find({ type: 'Text', text: /── Claude/ })).toBeUndefined()
    expect((await ui.find({ type: 'Box' }))?.props).toMatchObject({ paddingLeft: 2 })
  })

  test('a drawn block gets its box once the turn ends with it as the answer', async ($, on) => {
    engineBeneath(on)
    const ui = await mountReply($, 'terminal', PLAIN_ANSWER)
    expect(await ui.find({ type: 'Text', text: /── Claude/ })).toBeUndefined()
    await $.turn.complete({ ...TURN, answer: PLAIN_ANSWER })
    expect(await ui.find({ type: 'Text', text: /── Claude/ })).toBeDefined()
  })

  test('a long block that is part of the answer is boxed, a short one is not', async ($, on) => {
    engineBeneath(on)
    const part = 'Here is the first part of the answer, long enough to count.'
    await $.turn.complete({ ...TURN, answer: `${part}\n\nDone.` })
    expect(await (await mountReply($, 'terminal', part)).find({ type: 'Text', text: /── Claude/ })).toBeDefined()
    expect(await (await mountReply($, 'terminal', 'Done.')).find({ type: 'Text', text: /── Claude/ })).toBeUndefined()
  })

  test("a resumed transcript's final answers are boxed, its notes are not", async ($, on) => {
    const tool = { id: 't', name: 'Read', input: {} }
    const transcript = [
      { role: 'user', text: 'fix it', toolUses: [] },
      { role: 'assistant', text: NOTE, toolUses: [tool] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ toolUseId: 't' }] },
      { role: 'assistant', text: PLAIN_ANSWER, toolUses: [] },
      { role: 'user', text: 'thanks', toolUses: [] },
      { role: 'assistant', text: 'You are welcome, glad it is all working now.', toolUses: [] },
    ] as unknown as SessionMessage[]
    engineBeneath(on, transcript)
    await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
    const boxed = async (text: string) => (await (await mountReply($, 'terminal', text)).find({ type: 'Text', text: /── Claude/ })) !== undefined
    expect(await boxed(PLAIN_ANSWER)).toBe(true)
    expect(await boxed('You are welcome, glad it is all working now.')).toBe(true)
    expect(await boxed(NOTE)).toBe(false)
  })

  test('the transcript is read on the first draw, without a session start', async ($, on) => {
    engineBeneath(on, [{ role: 'assistant', text: PLAIN_ANSWER, toolUses: [] }] as unknown as SessionMessage[])
    const ui = await mountReply($, 'terminal', PLAIN_ANSWER)
    expect(await ui.find({ type: 'Text', text: /── Claude/ })).toBeDefined()
  })

  test('an interrupted turn does not box its text', async ($, on) => {
    engineBeneath(on)
    await $.turn.complete({ ...TURN, answer: PLAIN_ANSWER, isAborted: true, reason: 'aborted' })
    const ui = await mountReply($, 'terminal', PLAIN_ANSWER)
    expect(await ui.find({ type: 'Text', text: /── Claude/ })).toBeUndefined()
  })

  test('summaries and other surfaces are left to the engine', async ($, on) => {
    engineBeneath(on)
    for (const ui of [await mountReply($, 'terminal', ANSWER, true), await mountReply($, 'desktop', ANSWER)]) {
      expect(await ui.find(fromEngine)).toBeDefined()
    }
  })

  test('with boxes set to all, notes are boxed too', { options: { boxes: 'all' } }, async ($, on) => {
    engineBeneath(on)
    const ui = await mountReply($, 'terminal', NOTE)
    expect((await ui.find({ type: 'Text', text: /── Claude/ }))?.props).toMatchObject({ color: 'claude' })
  })
})

const strongTexts = async (ui: Awaited<ReturnType<typeof mountReply>>, style: Record<string, unknown> = ACCENT) =>
  (await ui.findAll({ type: 'Text' }))
    .filter(t => Object.entries(style).every(([k, v]) => t.props[k] === v))
    .map(t => t.text)

describe('bold text', () => {
  test('is drawn in the accent color, and parts without bold stay with the engine', async ($, on) => {
    engineBeneath(on)
    const ui = await mountAnswer($, ANSWER)
    expect(await strongTexts(ui)).toEqual(['Agent Monitor', 'Ember'])
    expect((await ui.findAll({ type: 'Markdown' })).map(m => m.text)).toEqual(['Both are done.'])
    expect((await ui.findAll({ type: 'Text', text: /^-$/ })).length).toBe(2)
    expect(await ui.find({ type: 'Text', text: 'is pushed' })).toBeDefined()
  })

  test('keeps list numbers, inline code, italics and links', async ($, on) => {
    engineBeneath(on)
    const text = '3. **Run** `npm test` *first*\n4. See [the docs](https://example.com/docs)'
    const ui = await mountReply($, 'terminal', text)
    expect(await strongTexts(ui)).toEqual(['Run'])
    expect((await ui.findAll({ type: 'Text', text: /^\d\.$/ })).map(t => t.text)).toEqual(['3.', '4.'])
    expect((await ui.find({ type: 'Text', text: /^npm test$/ }))?.props).toMatchObject({ color: 'permission' })
    expect((await ui.find({ type: 'Text', text: /^first$/ }))?.props).toMatchObject({ italic: true })
    expect((await ui.find({ type: 'Link' }))?.props).toMatchObject({ href: 'https://example.com/docs' })
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  })

  test('nested lists keep their markers and indents', async ($, on) => {
    engineBeneath(on)
    const text = '1. **Install** it:\n   1. download\n   2. unzip\n\n   Then restart.\n2. Done'
    const ui = await mountAnswer($, text)
    expect((await ui.findAll({ type: 'Text', text: /^[\da-z]\.$/ })).map(t => t.text)).toEqual(['1.', 'a.', 'b.', '2.'])
    const rows = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexDirection === 'row' && b.props.paddingLeft !== undefined)
    expect(rows.map(b => b.props.paddingLeft)).toEqual([0, 3, 3, 0])
    expect((await ui.findAll({ type: 'Box' })).find(b => b.props.paddingLeft === 3 && b.props.marginTop === 1)).toBeDefined()
  })

  test('does not mistake snake_case, arithmetic or code for emphasis', async ($, on) => {
    engineBeneath(on)
    const text = '**Note:** set my_config_value to 2 * 3 * 4 and keep `**raw**` as is'
    const ui = await mountReply($, 'terminal', text)
    expect(await strongTexts(ui)).toEqual(['Note:'])
    expect((await ui.findAll({ type: 'Text' })).some(t => t.props.italic)).toBe(false)
    expect((await ui.find({ type: 'Text', text: /^\*\*raw\*\*$/ }))?.props).toMatchObject({ color: 'permission' })
    expect(await ui.find({ type: 'Text', text: 'my_config_value to 2 * 3 * 4' })).toBeDefined()
  })

  test('code blocks and tables are left to the engine, bold or not', async ($, on) => {
    engineBeneath(on)
    const fence = '```js\nconst a = "**not bold**"\n```'
    const table = '| Mod | State |\n| --- | --- |\n| **Ember** | on |'
    const ui = await mountReply($, 'terminal', `**Done.** Here it is:\n\n${fence}\n\n${table}`)
    expect(await strongTexts(ui)).toEqual(['Done.'])
    expect((await ui.findAll({ type: 'Markdown' })).map(m => m.text)).toEqual([`${fence}\n\n${table}`])
  })

  test('a note colors its bold text too, and is not dimmed', async ($, on) => {
    engineBeneath(on)
    const ui = await mountReply($, 'terminal', 'Now **reading** the theme.')
    expect(await strongTexts(ui)).toEqual(['reading'])
    expect((await ui.findAll({ type: 'Text' })).some(t => t.props.dimColor)).toBe(false)
  })

  test('with bold set to highlight, bold text gets a background', { options: { bold: 'highlight' } }, async ($, on) => {
    engineBeneath(on)
    const ui = await mountAnswer($, ANSWER)
    expect(await strongTexts(ui, { bold: true, backgroundColor: 'selectionBg' })).toEqual(['Agent Monitor', 'Ember'])
  })

  test('with bold set to off, the engine draws the whole answer', { options: { bold: 'off' } }, async ($, on) => {
    engineBeneath(on)
    const ui = await mountAnswer($, ANSWER)
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe(ANSWER)
    expect(await strongTexts(ui)).toEqual([])
  })
})

describe('callouts', () => {
  const WARN = 'All set.\n\n> [!WARNING]\n> The **token** expires on Friday.\n> Renew it first.\n\nThat is all.'

  test('an alert block is a callout in its color, with its body drawn as markdown', async ($, on) => {
    engineBeneath(on)
    const ui = await mountAnswer($, WARN, 60)
    const head = await ui.find({ type: 'Text', text: /^── Warning ─+$/ })
    expect(head?.props).toMatchObject({ color: 'warning' })
    expect(head?.text.length).toBe(56)
    expect((await ui.findAll({ type: "Box" })).find(b => b.props.paddingLeft === 2 && b.props.paddingRight === 2)).toBeDefined()
    expect(await strongTexts(ui)).toEqual(['token'])
    expect(await ui.find({ type: 'Text', text: /Renew it first/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Markdown' })).map(m => m.text)).toEqual(['All set.', 'That is all.'])
    expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle)).toBe(false)
  })

  test('each level has its own label and color, and a note can hold one', async ($, on) => {
    engineBeneath(on)
    const levels = [['NOTE', 'Note', 'suggestion'], ['tip', 'Tip', 'success'], ['IMPORTANT', 'Important', 'merged'], ['CAUTION', 'Caution', 'error']] as const
    for (const [tag, label, color] of levels) {
      const ui = await mountReply($, 'terminal', `> [!${tag}] Read this.`)
      expect((await ui.find({ type: 'Text', text: new RegExp(`^── ${label} `) }))?.props).toMatchObject({ color })
      expect((await ui.find({ type: 'Markdown' }))?.text).toBe('Read this.')
    }
  })

  test('alert markers in code fences and plain quotes are left alone', async ($, on) => {
    engineBeneath(on)
    const text = '```md\n> [!WARNING]\n> not a callout\n```\n\n> just a quote'
    const ui = await mountAnswer($, text)
    expect(await ui.find({ type: 'Text', text: /── Warning/ })).toBeUndefined()
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe(text)
  })
})

describe('callout hint', () => {
  test('tells the model once, in the conversation context', async ($, on) => {
    engineBeneath(on)
    const { blocks } = await $.prompt.context({ blocks: [{ name: 'currentDate', text: 'today' }] })
    expect(blocks.map(b => b.name)).toEqual(['currentDate', 'terminalCallouts'])
    expect(blocks[1]?.text).toMatch(/\[!WARNING\]/)
  })

  test('is left out when calloutHint is off', { options: { calloutHint: 'off' } }, async ($, on) => {
    engineBeneath(on)
    const { blocks } = await $.prompt.context({ blocks: [] })
    expect(blocks).toEqual([])
  })
})

describe('end of turn', () => {
  test('draws a rule across the width with the time taken', async ($, on) => {
    engineBeneath(on)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'TurnDuration',
      props: { word: 'Baked', durationMs: 65_000 },
      viewport: { columns: 60, rows: 30 },
    })
    const rule = (await ui.find({ type: 'Text' }))?.text ?? ''
    expect(rule.startsWith('── ✻ Baked for 1m 5s ──')).toBe(true)
    expect(rule).toMatch(/ \d\d:\d\d (AM|PM) ──$/)
    expect(rule.length).toBe(60)
  })
})

const HOUR = 60 * 60 * 1000
const TURN = { answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as const

describe('prompt cache expiry', () => {
  test('puts a line in the transcript an hour after the last turn', async ($, on) => {
    const clock = mock.clock(on)
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    const lines: string[] = []
    on('ui.log', ($, e, next) => (lines.push(e.text), next(e)))
    await $.turn.complete(TURN)
    await clock.advance(HOUR - 1000)
    expect(lines).toEqual([])
    await clock.advance(1000)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^✻ Prompt cache expired at \d\d:\d\d (AM|PM)$/)
  })

  test('a later turn restarts the wait', async ($, on) => {
    const clock = mock.clock(on)
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    const lines: string[] = []
    on('ui.log', ($, e, next) => (lines.push(e.text), next(e)))
    await $.turn.complete(TURN)
    await clock.advance(HOUR - 1000)
    await $.turn.complete({ ...TURN, turnId: 't2' })
    await clock.advance(HOUR - 1000)
    expect(lines).toEqual([])
    await clock.advance(1000)
    expect(lines).toHaveLength(1)
  })

  test('is drawn as a rule across the width', async ($, on) => {
    engineBeneath(on)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'InfoNotice',
      props: { text: '✻ Prompt cache expired at 03:50 PM', command: null },
      viewport: { columns: 60, rows: 30 },
    })
    const rule = (await ui.find({ type: 'Text' }))?.text ?? ''
    expect(rule.startsWith('── ✻ Prompt cache expired at 03:50 PM ─')).toBe(true)
    expect(rule.length).toBe(60)
  })

  test('leaves other notices to the engine', async ($, on) => {
    on('ui.render', { component: 'InfoNotice' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine: {e.props.text}</Text>
    })
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'InfoNotice',
      props: { text: 'Something else', command: null },
    })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine: Something else')
  })
})

describe('keepwarm', () => {
  const MIN = 60 * 1000
  const warmReply = { isAnswered: true, text: 'ok', usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 200000, cache_creation_input_tokens: 0 } }
  const coldReply = { isAnswered: true, text: 'ok', usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 200000 } }

  // Moves the clock, then lets the refresh the move woke run to its end before the next step.
  const advance = async (clock: MockClock, ms: number) => {
    await clock.advance(ms)
    await clock.settle()
  }

  // Each fork answers the next of `replies`; the last one repeats.
  const setup = (on: On, replies: unknown[]) => {
    const clock = mock.clock(on)
    const forks: number[] = []
    const lines: string[] = []
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('model.fork', async () => {
      const reply = replies[Math.min(forks.length, replies.length - 1)]
      forks.push(forks.length)
      return { value: reply as never }
    })
    on('ui.log', ($, e, next) => (lines.push(e.text), next(e)))
    return { clock, forks, lines }
  }

  test('each warm refresh pushes the expiry an hour past itself', { options: { keepwarm: 'on' } }, async ($, on) => {
    const { clock, forks, lines } = setup(on, [warmReply])
    await $.turn.complete(TURN)
    await advance(clock, 50 * MIN)
    expect(forks).toHaveLength(1)
    // Each refresh comes 50 minutes after the last and moves the expiry on: 100 min, then 150 min, so 210 min.
    await advance(clock, 50 * MIN)
    expect(forks).toHaveLength(2)
    await advance(clock, 50 * MIN)
    expect(forks).toHaveLength(3)
    await advance(clock, 60 * MIN - 1000)
    expect(lines).toEqual([])
    await advance(clock, 1000)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^✻ Prompt cache expired at /)
  })

  test('a cold refresh says so at once, then the reply has re-warmed the cache', { options: { keepwarm: 'on' } }, async ($, on) => {
    const { clock, forks, lines } = setup(on, [coldReply, warmReply])
    await $.turn.complete(TURN)
    await advance(clock, 50 * MIN)
    expect(lines).toHaveLength(1)
    // The cold reply rewrote the cache, so the next refresh is warm and prints nothing more.
    await advance(clock, 50 * MIN)
    expect(forks).toHaveLength(2)
    expect(lines).toHaveLength(1)
  })

  test('stops refreshing after three warm refreshes', { options: { keepwarm: 'on' } }, async ($, on) => {
    const { clock, forks } = setup(on, [warmReply])
    await $.turn.complete(TURN)
    await advance(clock, 5 * 60 * MIN)
    expect(forks).toHaveLength(3)
  })

  test('sends nothing when keepwarm is off', async ($, on) => {
    const { clock, forks, lines } = setup(on, [warmReply])
    await $.turn.complete(TURN)
    await advance(clock, HOUR)
    expect(forks).toEqual([])
    expect(lines).toHaveLength(1)
  })
})

describe('/keepalive', () => {
  const MIN = 60 * 1000
  const warmReply = { isAnswered: true, text: 'ok', usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 200000, cache_creation_input_tokens: 0 } }
  const setup = (on: On) => {
    const clock = mock.clock(on)
    const forks: number[] = []
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('model.fork', async () => {
      forks.push(forks.length)
      return { value: warmReply as never }
    })
    return { clock, forks }
  }
  const run = ($: Engine, args: string) => $.command.run({ command: 'keepalive', args })

  test('60 is minutes: a refresh at 50 minutes, one at the end, then nothing', async ($, on) => {
    const { clock, forks } = setup(on)
    await $.turn.complete(TURN)
    const { text } = await run($, '60')
    expect(text).toContain('keepalive on for 1h 0m')
    await clock.advance(50 * MIN)
    await clock.settle()
    expect(forks).toHaveLength(1)
    await clock.advance(10 * MIN)
    await clock.settle()
    expect(forks).toHaveLength(2)
    await clock.advance(5 * 60 * MIN)
    await clock.settle()
    expect(forks).toHaveLength(2)
  })

  test('5h runs for five hours', async ($, on) => {
    const { clock, forks } = setup(on)
    await $.turn.complete(TURN)
    expect((await run($, '5h')).text).toContain('keepalive on for 5h 0m')
    await clock.advance(5 * 60 * MIN)
    await clock.settle()
    expect(forks).toHaveLength(6)
  })

  test('2h30m and 90m are read as durations', async ($, on) => {
    setup(on)
    await $.turn.complete(TURN)
    expect((await run($, '2h30m')).text).toContain('for 2h 30m')
    expect((await run($, '90m')).text).toContain('for 1h 30m')
  })

  test('no warning while the last turn is inside the one-hour cutoff', async ($, on) => {
    const clock = mock.clock(on)
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await $.turn.complete(TURN)
    await clock.advance(12 * MIN)
    const { text } = await run($, '60')
    expect(text).not.toContain('warning')
    expect(text).toContain('keepalive on for 1h 0m')
  })

  test('warns, and does not start, once the last turn is past the one-hour cutoff', async ($, on) => {
    const clock = mock.clock(on)
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await $.turn.complete(TURN)
    await clock.advance(HOUR + MIN)
    const { text } = await run($, '60')
    expect(text).toContain('warning: the last turn was 61m 0s ago')
    expect(text).not.toContain('keepalive on')
  })

  test('off stops the window', async ($, on) => {
    const { clock, forks } = setup(on)
    await $.turn.complete(TURN)
    await run($, '60')
    expect((await run($, 'off')).text).toContain('keepalive is off')
    await clock.advance(50 * MIN)
    await clock.settle()
    expect(forks).toEqual([])
  })

  test('rejects text that is not a duration', async ($, on) => {
    setup(on)
    await $.turn.complete(TURN)
    expect((await run($, 'soon')).text).toContain('is not a duration')
    expect((await run($, '0')).text).toContain('is not a duration')
  })

  test('says so when no turn has run and there is no transcript', async ($, on) => {
    mock.env(on, {})
    setup(on)
    expect((await run($, '60')).text).toContain('no turn has run')
  })
})

describe('/cache-age', () => {
  test('says so when no turn has finished, and still reports keepalive and context', async ($, on) => {
    mock.clock(on)
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 50000 }, rateLimits: [] } }))
    const { text } = await $.command.run({ command: 'cache-age', args: '' })
    expect(text).toMatch(/No turn has finished/)
    expect(text).toContain('Keepalive:      off')
    expect(text).toContain('Context:        50,000 of 200,000 tokens (25%)')
  })

  test('reports the keepalive window and the context size', async ($, on) => {
    const MIN = 60 * 1000
    const clock = mock.clock(on)
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('model.fork', () => ({ value: { isAnswered: true, text: 'ok', usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 200000, cache_creation_input_tokens: 0 } } as never }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 120000 }, rateLimits: [] } }))
    await $.turn.complete(TURN)
    await $.command.run({ command: 'keepalive', args: '2h' })
    await clock.advance(10 * MIN)
    const { text } = await $.command.run({ command: 'cache-age', args: '' })
    expect(text).toContain('Keepalive:      on until')
    expect(text).toContain('(1h 50m left)')
    expect(text).toContain('Context:        120,000 of 200,000 tokens (60%)')
  })

  test('reports the age and the time left, then the time since expiry', async ($, on) => {
    const clock = mock.clock(on)
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 1000 }, rateLimits: [] } }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await $.turn.complete(TURN)
    await clock.advance(12 * 60 * 1000)
    let { text } = await $.command.run({ command: 'cache-age', args: '' })
    expect(text).toContain('(12m 0s ago)')
    expect(text).toContain('in 48m 0s')
    await clock.advance(HOUR)
    ;({ text } = await $.command.run({ command: 'cache-age', args: '' }))
    expect(text).toContain('Cache expired:')
    expect(text).toContain('(12m 0s ago)')
  })
})
