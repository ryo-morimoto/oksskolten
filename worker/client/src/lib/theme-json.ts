import { themes as builtinThemes, type Theme } from '../data/themes'

/** Mapping from user-friendly JSON keys to CSS custom property names */
const PROPERTY_MAP: Record<string, string> = {
  'background':         '--color-bg',
  'background.sidebar': '--color-bg-sidebar',
  'background.subtle':  '--color-bg-subtle',
  'background.avatar':  '--color-bg-avatar',
  'background.input':   '--color-bg-input',
  'background.card':    '--color-bg-card',
  'background.header':  '--color-bg-header',
  'text':               '--color-text',
  'text.muted':         '--color-muted',
  'text.code':          '--color-code',
  'accent':             '--color-accent',
  'accent.text':        '--color-accent-text',
  'error':              '--color-error',
  'border':             '--color-border',
  'hover':              '--color-hover',
  'overlay':            '--color-overlay',
}

const REQUIRED_KEYS = [
  'background', 'background.sidebar', 'background.subtle', 'background.avatar',
  'text', 'text.muted',
  'accent', 'accent.text',
  'error', 'border', 'hover', 'overlay',
]

const BUILTIN_NAMES = new Set(builtinThemes.map(t => t.name))

const NAME_RE = /^[a-z0-9_-]+$/

export type ThemeJsonError = { key: string; params?: Record<string, string> }

/** Validate and convert user-facing JSON into an internal Theme object. */
export function parseThemeJson(
  json: unknown,
  existingCustomNames: Set<string>,
): { theme: Theme } | { error: ThemeJsonError } {
  if (!json || typeof json !== 'object') {
    return { error: { key: 'themeJson.invalidJson' } }
  }

  const obj = json as Record<string, unknown>

  // name
  if (typeof obj.name !== 'string' || !obj.name) {
    return { error: { key: 'themeJson.missingName' } }
  }
  const name = obj.name.trim()
  if (!NAME_RE.test(name)) {
    return { error: { key: 'themeJson.invalidName', params: { name } } }
  }
  if (BUILTIN_NAMES.has(name)) {
    return { error: { key: 'themeJson.builtinConflict', params: { name } } }
  }
  if (existingCustomNames.has(name)) {
    return { error: { key: 'themeJson.duplicateName', params: { name } } }
  }

  // label
  if (typeof obj.label !== 'string' || !obj.label) {
    return { error: { key: 'themeJson.missingLabel' } }
  }
  const label = obj.label.trim().slice(0, 50)

  // colors
  if (!obj.colors || typeof obj.colors !== 'object') {
    return { error: { key: 'themeJson.missingColors' } }
  }
  const colorsObj = obj.colors as Record<string, unknown>

  if (!colorsObj.light || typeof colorsObj.light !== 'object') {
    return { error: { key: 'themeJson.missingColorsVariant', params: { variant: 'light' } } }
  }
  if (!colorsObj.dark || typeof colorsObj.dark !== 'object') {
    return { error: { key: 'themeJson.missingColorsVariant', params: { variant: 'dark' } } }
  }

  const lightResult = convertColorMap(colorsObj.light as Record<string, unknown>, 'light')
  if ('error' in lightResult) return lightResult
  const darkResult = convertColorMap(colorsObj.dark as Record<string, unknown>, 'dark')
  if ('error' in darkResult) return darkResult

  // optional fields
  const indicatorStyle = obj.indicatorStyle === 'line' ? 'line' as const : 'dot' as const
  const highlight = typeof obj.highlight === 'string' ? obj.highlight : 'github'

  return {
    theme: {
      name,
      label,
      indicatorStyle,
      highlight,
      colors: {
        light: lightResult.colors,
        dark: darkResult.colors,
      },
    },
  }
}

function convertColorMap(
  input: Record<string, unknown>,
  variant: 'light' | 'dark',
): { colors: Record<string, string> } | { error: ThemeJsonError } {
  const result: Record<string, string> = {}

  // Check required keys
  for (const key of REQUIRED_KEYS) {
    if (typeof input[key] !== 'string' || !input[key]) {
      return { error: { key: 'themeJson.missingColor', params: { path: `colors.${variant}.${key}` } } }
    }
  }

  // Convert all known keys
  for (const [jsonKey, cssVar] of Object.entries(PROPERTY_MAP)) {
    const value = input[jsonKey]
    if (typeof value === 'string' && value) {
      result[cssVar] = value
    }
  }

  return { colors: result }
}

/** Convert an internal Theme back to the user-facing JSON format. */
export function themeToJson(theme: Theme): Record<string, unknown> {
  const CSS_TO_JSON = Object.fromEntries(
    Object.entries(PROPERTY_MAP).map(([k, v]) => [v, k]),
  )

  const convertBack = (colors: Record<string, string>) => {
    const out: Record<string, string> = {}
    for (const [cssVar, value] of Object.entries(colors)) {
      const jsonKey = CSS_TO_JSON[cssVar]
      if (jsonKey) out[jsonKey] = value
    }
    return out
  }

  return {
    name: theme.name,
    label: theme.label,
    colors: {
      light: convertBack(theme.colors.light),
      dark: convertBack(theme.colors.dark),
    },
  }
}
