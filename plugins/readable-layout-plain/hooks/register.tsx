import type { Register, RenderElement } from 'claude-code'
import { drawMarkdown, type Emphasis } from './markdown'

const SHORT_NOTE_CHARS = 160

const isShortNote = (text: string): boolean => !text.includes('\n') && text.length <= SHORT_NOTE_CHARS

const fmtDuration = (ms: number): string => {
  const s = Math.max(1, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m ? `${m}m ${s % 60}s` : `${s}s`
}

export const register: Register = (on, options) => {
  const boxesAll = options.boxes === 'all'
  const emphasis: Emphasis = options.bold === 'highlight' || options.bold === 'off' ? options.bold : 'color'

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
    return (
      <Box marginTop={1}>
        <Text color="subtle" wrap="truncate-end">
          {`──${label}${'─'.repeat(Math.max(0, width - label.length - 2))}`}
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
