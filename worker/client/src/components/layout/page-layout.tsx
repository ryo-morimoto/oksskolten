import { useState, useRef, useEffect, type ReactNode } from 'react'
import { useAppLayout } from '@/app'
import { MD_BREAKPOINT } from '@/lib/breakpoints'
import { KeyboardNavigationProvider } from '@/contexts/keyboard-navigation-context'
import { Header } from '@/components/layout/header'
import { FeedList } from '@/components/feed/feed-list'

interface PageLayoutProps {
  /** Header mode */
  mode?: 'list' | 'detail'
  /** Feed name shown in header center (list mode) */
  feedName?: string | null
  /** Back button handler (detail mode) */
  onBack?: () => void
  /** Title shown in detail mode header */
  detailTitle?: string | null
  /** Extra FeedList props */
  feedListProps?: {
    onMarkAllRead?: () => void
    onArticleMoved?: () => void
  }
  children: ReactNode
}

export function PageLayout({ mode = 'list', feedName, onBack, detailTitle, feedListProps, children }: PageLayoutProps) {
  const { sidebarOpen: drawerOpen, setSidebarOpen: setDrawerOpen } = useAppLayout()

  const [isScrolled, setIsScrolled] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Keep sidebar open state synced with md+ breakpoint
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`)
    const handler = (e: MediaQueryListEvent) => setDrawerOpen(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [setDrawerOpen])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setIsScrolled(!entry.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <KeyboardNavigationProvider>
      <FeedList
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onBackdropClose={() => setDrawerOpen(false)}
        onCollapse={() => setDrawerOpen(false)}
        onMarkAllRead={feedListProps?.onMarkAllRead}
        onArticleMoved={feedListProps?.onArticleMoved}
      />
      <div className={`transition-[margin] duration-200 ${drawerOpen ? 'md:ml-[var(--sidebar-width)]' : ''}`}>
        {mode === 'detail' ? (
          <Header mode="detail" onBack={onBack} detailTitle={detailTitle} isScrolled={isScrolled} sidebarOpen={drawerOpen} />
        ) : (
          <Header mode="list" onMenuClick={() => setDrawerOpen(true)} feedName={feedName} isScrolled={isScrolled} sidebarOpen={drawerOpen} />
        )}
        <div ref={sentinelRef} className="h-0" />
        {children}
      </div>
    </KeyboardNavigationProvider>
  )
}
