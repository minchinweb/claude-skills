import type { EngineInterface, Register, RenderElement, Timer } from 'claude-code'
import { drawMarkdown, type Emphasis } from './markdown'

const SHORT_NOTE_CHARS = 160
const MIN_MS = 60 * 1000

const isShortNote = (text: string): boolean => !text.includes('\n') && text.length <= SHORT_NOTE_CHARS

const fmtDuration = (ms: number): string => {
  const s = Math.max(1, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m ? `${m}m ${s % 60}s` : `${s}s`
}

// A window in hours and minutes, e.g. "1h 30m" or "45m".
const fmtSpan = (ms: number): string => {
  const m = Math.round(ms / MIN_MS)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

// 12-hour clock with a leading zero and AM/PM, e.g. "03:45 PM".
const fmtClock = (d: Date): string => {
  const h = d.getHours()
  const hh = String(h % 12 || 12).padStart(2, '0')
  return `${hh}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// A subscription's prompt cache lives for an hour after the last request.
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_EXPIRED = '✻ Prompt cache expired at'
// keepwarm: refresh this long after the last warm moment, before the cache can lapse.
const REFRESH_MS = 50 * 60 * 1000
// keepwarm: most refreshes per break, so an open session does not ping forever.
const MAX_REFRESHES = 3
// Same test as cache-tax: a warm reply reads the prefix and writes little of it.
const WARM_WRITE_SHARE = 0.1
const PROBE_PROMPT = 'Reply with the single word: ok'
// /keepalive: the longest window one command may arm.
const MAX_WINDOW_MS = 24 * 60 * MIN_MS

// Cache state for the main conversation. `expiresAt` is when the cache is due to
// lapse: an hour after the last warm moment, where a warm moment is a turn's end or
// a warm refresh. `turnGen` bumps when a turn starts, so a stale timer or refresh
// from before it is ignored. `deadline` is the end of a /keepalive window, if one is
// open; refreshes inside it run every 50 minutes and once more at the deadline.
type CacheState = {
  keepwarm: boolean
  turnGen: number
  lastTurnAt?: number
  lastRefreshAt?: number
  expiresAt?: number
  refreshes: number
  deadline?: number
  expiry?: Timer
  refresh?: Timer
}

function clearTimers(c: CacheState): void {
  c.expiry?.cancel()
  c.refresh?.cancel()
  c.expiry = undefined
  c.refresh = undefined
}

// Called only at a warm moment, so the wait is always a full hour from now.
function armExpiry(c: CacheState, $: EngineInterface, gen: number): void {
  c.expiry?.cancel()
  c.expiry = $.clock.after(CACHE_TTL_MS, () => checkExpiry(c, $, gen))
}

// Print only if the cache really is due: a warm refresh or a new turn since this
// was armed moves expiresAt or bumps turnGen, and the line stays out.
async function checkExpiry(c: CacheState, $: EngineInterface, gen: number): Promise<void> {
  const now = await $.clock.now()
  if (gen !== c.turnGen || c.expiresAt === undefined || now < c.expiresAt) return
  $.ui.log(`${CACHE_EXPIRED} ${fmtClock(new Date(c.expiresAt))}`)
}

function armRefresh(c: CacheState, $: EngineInterface, gen: number, delay: number): void {
  c.refresh?.cancel()
  c.refresh = $.clock.after(delay, () => sendRefresh(c, $, gen))
}

// The next refresh: 50 minutes on, or the window's deadline if that comes first.
function refreshDelay(c: CacheState, now: number): number {
  return c.deadline === undefined ? REFRESH_MS : Math.min(REFRESH_MS, c.deadline - now)
}

// One tool-less one-word fork over the session's transcript. Its usage says whether
// the cache was still warm when it ran; only a warm reply extends the wait.
async function sendRefresh(c: CacheState, $: EngineInterface, gen: number): Promise<void> {
  c.refresh = undefined
  if (gen !== c.turnGen) return
  const reply = await $.model.fork({ prompt: PROBE_PROMPT, effort: 'low' })
  const at = await $.clock.now()
  // A turn started while the refresh was out; its own turn.complete owns the wait now.
  if (gen !== c.turnGen) return
  if (!reply.isAnswered) {
    // nothing-to-fork or an API error says nothing about the cache: an open window tries again, until its deadline.
    if (c.deadline !== undefined) {
      if (at >= c.deadline) c.deadline = undefined
      else armRefresh(c, $, gen, refreshDelay(c, at))
    }
    return
  }
  const u = reply.usage
  const warm = u.cache_read_input_tokens > 0 && u.cache_creation_input_tokens < WARM_WRITE_SHARE * u.cache_read_input_tokens
  // A cold reply means the cache had lapsed before this refresh. The reply rewrote it, so it is warm from `at` on.
  if (!warm) $.ui.log(`${CACHE_EXPIRED} ${fmtClock(new Date(at))}`)
  c.refreshes++
  c.lastRefreshAt = at
  c.expiresAt = at + CACHE_TTL_MS
  armExpiry(c, $, gen)
  if (c.deadline !== undefined) {
    // The window's last refresh is the one at its deadline; after it the window is over.
    if (at >= c.deadline) c.deadline = undefined
    else armRefresh(c, $, gen, refreshDelay(c, at))
  } else if (c.keepwarm && c.refreshes < MAX_REFRESHES) {
    armRefresh(c, $, gen, REFRESH_MS)
  }
}

// The transcript file's last write, which is the last turn's end. The session's file
// lives under ~/.claude/projects, in a folder named after its working directory.
async function transcriptMtime($: EngineInterface): Promise<number | undefined> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) return undefined
  const cwd = await $.session.cwd()
  const folder = cwd.replace(/[^A-Za-z0-9]/g, '-')
  const id = await $.session.id()
  const stat = await $.fs.stat(`${home}/.claude/projects/${folder}/${id}.jsonl`).catch(() => undefined)
  return stat?.mtimeMs
}

// `60` is minutes; `90m`, `5h` and `2h30m` work too. Undefined when it is none of these.
function parseDuration(text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number(text) * MIN_MS || undefined
  const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(text)
  if (!m || (m[1] === undefined && m[2] === undefined)) return undefined
  return (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * MIN_MS || undefined
}

// The window's state for /keepalive and /cache-age: on until when, or off.
function keepaliveState(c: CacheState, now: number): string {
  if (c.deadline === undefined || now >= c.deadline) return 'off'
  return `on until ${fmtClock(new Date(c.deadline))} (${fmtSpan(c.deadline - now)} left)`
}

function keepaliveStatus(c: CacheState, now: number): string {
  if (c.deadline === undefined || now >= c.deadline) return 'keepalive is off. Run /keepalive 60 to keep the cache warm for an hour.'
  return `keepalive is ${keepaliveState(c, now)}.`
}

export const register: Register = (on, options) => {
  const boxesAll = options.boxes === 'all'
  const emphasis: Emphasis = options.bold === 'highlight' || options.bold === 'off' ? options.bold : 'color'
  const c: CacheState = { keepwarm: options.keepwarm === 'on', turnGen: 0, refreshes: 0 }

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      c.turnGen++
      clearTimers(c)
    }
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      c.lastTurnAt = now
      c.lastRefreshAt = undefined
      c.refreshes = 0
      c.expiresAt = now + CACHE_TTL_MS
      if (c.deadline !== undefined && now >= c.deadline) c.deadline = undefined
      clearTimers(c)
      armExpiry(c, $, c.turnGen)
      if (c.deadline !== undefined || c.keepwarm) armRefresh(c, $, c.turnGen, refreshDelay(c, now))
    }
    return next(e)
  })

  // /cache-age: how old the prompt cache is and when it runs out.
  // /keepalive: refresh the cache through a window of time, e.g. `/keepalive 60` or `/keepalive 5h`.
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cache-age', description: 'Show when the prompt cache last refreshed and when it expires' })
    await $.command.register({
      name: 'keepalive',
      description: 'Refresh the prompt cache through a window: minutes or 90m, 5h, 2h30m; off stops it',
      argumentHint: '[minutes|5h|off]',
    })
    return next(e)
  })
  on('command.run', { command: 'keepalive' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === '') return { text: keepaliveStatus(c, await $.clock.now()) }
    if (arg === 'off') {
      c.deadline = undefined
      c.refresh?.cancel()
      c.refresh = undefined
      return { text: 'keepalive is off. The cache is left to run out.' }
    }
    const ms = parseDuration(arg)
    if (ms === undefined) return { text: `keepalive: "${e.args.trim()}" is not a duration. Use minutes (60), 90m, 5h or 2h30m, or off.` }
    const now = await $.clock.now()
    // The last warm moment: this session's last turn or warm refresh, else the transcript file's last write.
    const warmAt = c.expiresAt !== undefined ? c.expiresAt - CACHE_TTL_MS : await transcriptMtime($)
    if (warmAt === undefined) return { text: 'keepalive: no turn has run in this session yet, so there is no cache to keep warm.' }
    const age = now - warmAt
    // Past the one-hour cutoff the cache has lapsed: a refresh would rewrite the whole context, so warn and do not start.
    if (age >= CACHE_TTL_MS) {
      return { text: `warning: the last turn was ${fmtDuration(age)} ago, past the one-hour cutoff, so the cache has lapsed and a refresh would rewrite the whole context. Send a message first, then run /keepalive.` }
    }
    const span = Math.min(ms, MAX_WINDOW_MS)
    c.deadline = now + span
    const gen = c.turnGen
    armRefresh(c, $, gen, Math.min(Math.max(0, warmAt + REFRESH_MS - now), span))
    const capped = ms > MAX_WINDOW_MS ? ' The window is capped at 24h.' : ''
    return { text: `keepalive on for ${fmtSpan(span)}, until ${fmtClock(new Date(c.deadline))}, with a refresh at the end.${capped}` }
  })
  on('command.run', { command: 'cache-age' }, async ($) => {
    const now = await $.clock.now()
    const lines: string[] = []
    if (c.lastTurnAt === undefined || c.expiresAt === undefined) {
      lines.push('No turn has finished in this session yet, so there is no cache age to report.')
    } else {
      const expiresAt = c.expiresAt
      const left = expiresAt - now
      lines.push(`Last turn ended: ${fmtClock(new Date(c.lastTurnAt))} (${fmtDuration(now - c.lastTurnAt)} ago)`)
      if (c.lastRefreshAt !== undefined) lines.push(`Last warm check: ${fmtClock(new Date(c.lastRefreshAt))} (${fmtDuration(now - c.lastRefreshAt)} ago), ${c.refreshes} so far`)
      lines.push(
        left > 0
          ? `Cache expires:   ${fmtClock(new Date(expiresAt))} (in ${fmtDuration(left)})`
          : `Cache expired:   ${fmtClock(new Date(expiresAt))} (${fmtDuration(-left)} ago)`,
      )
    }
    lines.push(`Keepalive:      ${keepaliveState(c, now)}`)
    const { context } = await $.session.usage()
    const window = context.window.toLocaleString('en-US')
    lines.push(context.tokens === undefined
      ? `Context:        unknown of ${window} tokens`
      : `Context:        ${context.tokens.toLocaleString('en-US')} of ${window} tokens (${context.percent ?? Math.round((context.tokens / context.window) * 100)}%)`)
    return { text: lines.join('\n') }
  })

  // The expiry line, drawn as a rule like the end-of-turn one.
  on('ui.render', { component: 'InfoNotice' }, ($, e, next) => {
    if (e.surface !== 'terminal' || !e.props.text.startsWith(CACHE_EXPIRED)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const label = ` ${e.props.text} `
    const width = Math.max(24, e.viewport?.columns ?? 80)
    return (
      <Box marginTop={1}>
        <Text color="subtle" wrap="truncate-end">
          {'──'}
          <Text color="green">{label}</Text>
          {'─'.repeat(Math.max(0, width - label.length - 2))}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.origin.kind !== 'composer' || !e.props.text.trim()) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return framed(Box, Text, 'You', 'suggestion', <Text>{e.props.text.trim()}</Text>, e.viewport?.columns)
  })

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const text = e.props.text.trim()
    if (e.surface !== 'terminal' || e.props.isSummary || !text) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    if (!boxesAll && isShortNote(text)) {
      return (
        <Box flexDirection="row" marginTop={1} paddingLeft={2}>
          <Text color="subtle">{'· '}</Text>
          {drawMarkdown(ui, text, emphasis, true)}
        </Box>
      )
    }
    return framed(Box, Text, 'Claude', 'claude', drawMarkdown(ui, text, emphasis), e.viewport?.columns)
  })

  on('ui.render', { component: 'TurnDuration' }, ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const label = ` ✻ ${e.props.word} for ${fmtDuration(e.props.durationMs)} `
    const width = Math.max(24, e.viewport?.columns ?? 80)
    // Wall clock on the right, like the PowerShell prompt.
    const clock = ` ${fmtClock(new Date())} `
    const fill = '─'.repeat(Math.max(0, width - label.length - clock.length - 4))
    return (
      <Box marginTop={1}>
        <Text color="subtle" wrap="truncate-end">
          {'──'}
          <Text color="green">{label}</Text>
          {fill}
          <Text color="green">{clock}</Text>
          {'──'}
        </Text>
      </Box>
    )
  })
}

type Element = (props: Record<string, unknown>, ...children: unknown[]) => RenderElement

// Top and bottom bars drawn as plain text rules, with no side bars. The
// engine does not accept per-side borders or custom border styles, so the
// bars are text, the same way the end-of-turn rule is drawn. Copying text
// from the terminal then picks up no box edges.
function framed(
  Box: Element,
  Text: Element,
  title: string,
  color: string,
  body: RenderElement,
  columns = 80,
): RenderElement {
  const width = Math.max(24, columns)
  const head = `── ${title} `
  const tail = '─'.repeat(Math.max(0, width - head.length))
  const rule = '─'.repeat(width)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={color} wrap="truncate-end">
        <Text bold>{head}</Text>
        {tail}
      </Text>
      <Box flexDirection="column">{body}</Box>
      <Text color={color} wrap="truncate-end">
        {rule}
      </Text>
    </Box>
  )
}
