import { useState, useEffect, useCallback } from 'react'
import { themes } from '../data/themes'

function getInitialTheme(): string {
  return localStorage.getItem('color-theme') || 'default'
}

function resolveColors(colors: Record<string, string>): Record<string, string> {
  const bg = colors['--color-bg']
  const text = colors['--color-text']
  return {
    '--color-bg-card': bg,
    '--color-bg-sidebar': bg,
    '--color-bg-header': bg,
    '--color-bg-input': bg,
    '--color-code': text,
    ...colors,
  }
}

function hexToRgbChannels(hex: string): string | null {
  const m = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!m) return null
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`
}

function syncThemeColorMeta(color: string) {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  metas.forEach(meta => { meta.content = color })
}

function applyTheme(themeName: string, isDark: boolean) {
  const theme = themes.find(t => t.name === themeName) ?? themes[0]
  const colors = resolveColors(isDark ? theme.colors.dark : theme.colors.light)
  const root = document.documentElement
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(key, value)
    if (key === '--color-bg-header') {
      const rgb = hexToRgbChannels(value)
      if (rgb) root.style.setProperty('--color-bg-header-rgb', rgb)
    }
  }
  const bg = colors['--color-bg']
  if (bg) {
    localStorage.setItem('theme-bg', bg)
    syncThemeColorMeta(bg)
  }
}

export function useTheme(isDark: boolean) {
  const [themeName, setThemeName] = useState(getInitialTheme)

  useEffect(() => {
    applyTheme(themeName, isDark)
  }, [themeName, isDark])

  const setTheme = useCallback((name: string) => {
    setThemeName(name)
    localStorage.setItem('color-theme', name)
  }, [])

  return { themeName, setTheme, themes }
}
