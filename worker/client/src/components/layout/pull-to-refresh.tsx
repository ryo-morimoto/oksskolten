import { useState, useRef, useCallback, useEffect } from 'react'
import { ArrowDown } from 'lucide-react'

interface PullToRefreshProps {
  onRefresh: () => void | Promise<unknown>
}

const PULL_THRESHOLD = 80
const MAX_PULL = 120

export function PullToRefresh({ onRefresh }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef(0)
  const pulling = useRef(false)
  const currentDistance = useRef(0)
  const rafId = useRef(0)
  const indicatorRef = useRef<HTMLDivElement>(null)

  const applyTransform = useCallback((distance: number) => {
    const el = indicatorRef.current
    if (!el) return
    if (distance === 0) {
      el.style.height = '0px'
      el.style.display = 'none'
      return
    }
    el.style.display = 'flex'
    el.style.height = `${distance}px`
    const progress = Math.min(distance / PULL_THRESHOLD, 1)
    const arrow = el.firstElementChild as HTMLElement | null
    if (arrow) {
      arrow.style.transform = `rotate(${progress * 180}deg)`
    }
  }, [])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (window.scrollY > 0) return
    startY.current = e.touches[0].clientY
    pulling.current = true
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pulling.current || refreshing) return
    const dy = e.touches[0].clientY - startY.current
    if (dy < 0) {
      currentDistance.current = 0
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => applyTransform(0))
      return
    }
    const dampened = Math.min(dy * 0.5, MAX_PULL)
    currentDistance.current = dampened
    cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(() => applyTransform(dampened))
  }, [refreshing, applyTransform])

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return
    pulling.current = false
    cancelAnimationFrame(rafId.current)

    const distance = currentDistance.current
    if (distance >= PULL_THRESHOLD && !refreshing) {
      const keepDistance = PULL_THRESHOLD * 0.5
      currentDistance.current = keepDistance
      setRefreshing(true)
      setPullDistance(keepDistance)
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
        setPullDistance(0)
        currentDistance.current = 0
        applyTransform(0)
      }
    } else {
      currentDistance.current = 0
      applyTransform(0)
    }
  }, [refreshing, onRefresh, applyTransform])

  useEffect(() => {
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: true })
    document.addEventListener('touchend', handleTouchEnd)
    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      cancelAnimationFrame(rafId.current)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

  return (
    <div
      ref={indicatorRef}
      className="items-center justify-center overflow-hidden select-none"
      style={{ height: pullDistance, display: pullDistance === 0 && !refreshing ? 'none' : 'flex' }}
    >
      <div style={{ transition: 'transform 0.1s' }}>
        {refreshing ? (
          <div className="w-5 h-5 border-2 border-muted border-t-accent rounded-full animate-spin" />
        ) : (
          <ArrowDown className="w-5 h-5 text-muted" />
        )}
      </div>
    </div>
  )
}
