import type { Register, RenderElement, Timer } from 'claude-code'
import { drawMarkdown, type Emphasis } from './markdown'

const SHORT_NOTE_CHARS = 160

const isShortNote = (text: string): boolean => !text.includes('\n') && text.length <= SHORT_NOTE_CHARS

const fmtDuration = (ms: number): string => {
  const s = Math.max(1, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m ? `${m}m ${s % 60}s` : `${s}s`
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

export const register: Register = (on, options) => {
  const boxesAll = options.boxes === 'all'
  const emphasis: Emphasis = options.bold === 'highlight' || options.bold === 'off' ? options.bold : 'color'

  // One timer for the main conversation: each turn restarts it, and when it runs
  // out with the session still open, a line goes into the transcript.
  let cacheTimer: Timer | undefined
  let lastTurnAt: number | undefined
  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) cacheTimer?.cancel()
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      lastTurnAt = await $.clock.now()
      cacheTimer?.cancel()
      cacheTimer = $.clock.after(CACHE_TTL_MS, () => $.ui.log(`${CACHE_EXPIRED} ${fmtClock(new Date())}`))
    }
    return next(e)
  })

  // /cache-age: how old the prompt cache is and when it runs out.
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cache-age', description: 'Show when the prompt cache last refreshed and when it expires' })
    return next(e)
  })
  on('command.run', { command: 'cache-age' }, async ($) => {
    if (lastTurnAt === undefined) return { text: 'No turn has finished in this session yet, so there is no cache age to report.' }
    const now = await $.clock.now()
    const expiresAt = lastTurnAt + CACHE_TTL_MS
    const left = expiresAt - now
    return {
      text: [
        `Last turn ended: ${fmtClock(new Date(lastTurnAt))} (${fmtDuration(now - lastTurnAt)} ago)`,
        left > 0
          ? `Cache expires:   ${fmtClock(new Date(expiresAt))} (in ${fmtDuration(left)})`
          : `Cache expired:   ${fmtClock(new Date(expiresAt))} (${fmtDuration(-left)} ago)`,
      ].join('\n'),
    }
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
