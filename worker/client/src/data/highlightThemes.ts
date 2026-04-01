export interface HighlightPreview {
  bg: string; text: string; keyword: string; string: string; comment: string
}

export interface HighlightThemeFamily {
  value: string  // family key (stored in DB / localStorage)
  label: string  // display name
  light: string  // CSS filename stem for light mode
  dark: string   // CSS filename stem for dark mode
  preview: { light: HighlightPreview; dark: HighlightPreview }
}

/** All available theme families (alphabetical order) */
export const highlightThemeFamilies: HighlightThemeFamily[] = [
  {
    value: 'atom-one', label: 'Atom One',
    light: 'atom-one-light', dark: 'atom-one-dark',
    preview: {
      light: { bg: '#fafafa', text: '#383a42', keyword: '#a626a4', string: '#50a14f', comment: '#a0a1a7' },
      dark:  { bg: '#282c34', text: '#abb2bf', keyword: '#c678dd', string: '#98c379', comment: '#5c6370' },
    },
  },
  {
    value: 'github', label: 'GitHub',
    light: 'github', dark: 'github-dark',
    preview: {
      light: { bg: '#fff', text: '#24292e', keyword: '#d73a49', string: '#032f62', comment: '#6a737d' },
      dark:  { bg: '#0d1117', text: '#c9d1d9', keyword: '#ff7b72', string: '#a5d6ff', comment: '#8b949e' },
    },
  },
  {
    value: 'github-dimmed', label: 'GitHub Dimmed',
    light: 'github', dark: 'github-dark-dimmed',
    preview: {
      light: { bg: '#fff', text: '#24292e', keyword: '#d73a49', string: '#032f62', comment: '#6a737d' },
      dark:  { bg: '#22272e', text: '#adbac7', keyword: '#f47067', string: '#96d0ff', comment: '#768390' },
    },
  },
  {
    value: 'nord', label: 'Nord',
    light: 'nord', dark: 'nord',
    preview: {
      light: { bg: '#2e3440', text: '#d8dee9', keyword: '#81a1c1', string: '#a3be8c', comment: '#4c566a' },
      dark:  { bg: '#2e3440', text: '#d8dee9', keyword: '#81a1c1', string: '#a3be8c', comment: '#4c566a' },
    },
  },
  {
    value: 'paraiso', label: 'Paraíso',
    light: 'paraiso-light', dark: 'paraiso-dark',
    preview: {
      light: { bg: '#e7e9db', text: '#4f424c', keyword: '#815ba4', string: '#48b685', comment: '#776e71' },
      dark:  { bg: '#2f1e2e', text: '#a39e9b', keyword: '#815ba4', string: '#48b685', comment: '#8d8687' },
    },
  },
  {
    value: 'rose-pine', label: 'Rosé Pine',
    light: 'rose-pine-dawn', dark: 'rose-pine',
    preview: {
      light: { bg: '#faf4ed', text: '#575279', keyword: '#907aa9', string: '#286983', comment: '#9893a5' },
      dark:  { bg: '#191724', text: '#e0def4', keyword: '#c4a7e7', string: '#31748f', comment: '#6e6a86' },
    },
  },
  {
    value: 'tokyo-night', label: 'Tokyo Night',
    light: 'tokyo-night-light', dark: 'tokyo-night-dark',
    preview: {
      light: { bg: '#d5d6db', text: '#565a6e', keyword: '#5a4a78', string: '#485e30', comment: '#9699a3' },
      dark:  { bg: '#1a1b26', text: '#9aa5ce', keyword: '#bb9af7', string: '#9ece6a', comment: '#565f89' },
    },
  },
  {
    value: 'vs', label: 'VS',
    light: 'vs', dark: 'vs2015',
    preview: {
      light: { bg: '#fff', text: '#000', keyword: '#00f', string: '#a31515', comment: '#008000' },
      dark:  { bg: '#1e1e1e', text: '#dcdcdc', keyword: '#569cd6', string: '#d69d85', comment: '#57a64a' },
    },
  },
]

/** Resolve a family key + isDark → CSS filename stem */
export function resolveHighlightCss(familyKey: string, isDark: boolean): string {
  const family = highlightThemeFamilies.find(f => f.value === familyKey)
  if (!family) return isDark ? 'github-dark' : 'github'
  return isDark ? family.dark : family.light
}
