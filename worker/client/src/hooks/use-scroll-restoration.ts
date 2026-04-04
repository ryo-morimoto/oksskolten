const scrollPositions = new Map<string, number>()

export function saveScrollPosition(pathname: string) {
  scrollPositions.set(pathname, window.scrollY)
}

/** Synchronously restore scroll – call from useLayoutEffect so it runs before paint. */
export function restoreScrollPosition(pathname: string) {
  const y = scrollPositions.get(pathname)
  if (y != null && y > 0) {
    window.scrollTo(0, y)
  }
}
