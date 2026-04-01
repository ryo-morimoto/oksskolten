import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useParams,
  useLocation,
  useOutletContext,
} from 'react-router-dom'
import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  lazy,
  Suspense,
} from 'react'
import useSWR, { SWRConfig } from 'swr'
import { useSettings, type Settings } from '@/hooks/use-settings'
import { fetcher } from '@/lib/fetcher'
import { LocaleContext, APP_NAME, type Locale, useI18n } from '@/lib/i18n'
import { MD_BREAKPOINT } from '@/lib/breakpoints'
import { useIsTouchDevice } from '@/hooks/use-is-touch-device'
import { saveScrollPosition, restoreScrollPosition } from '@/hooks/use-scroll-restoration'
import { useSwipeDrawer } from '@/hooks/use-swipe-drawer'
import { Header } from '@/components/layout/header'
import { PageLayout } from '@/components/layout/page-layout'
import { HintBanner } from '@/components/ui/hint-banner'
import { AuthShell } from '@/lib/auth-shell'
import { ErrorBoundary } from '@/components/auth/error-boundary'
import { Toaster } from 'sonner'
import { FetchProgressProvider } from '@/contexts/fetch-progress-context'
import { TooltipProvider } from '@/components/ui/tooltip'

const SettingsPage = lazy(() => import('./pages/settings-page').then(m => ({ default: m.SettingsPage })))
const HomePage = lazy(() => import('./pages/home-page').then(m => ({ default: m.HomePage })))

export interface AppLayoutContext {
  settings: Settings
  sidebarOpen: boolean
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
}

function AppLayout() {
  const settings = useSettings()
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`)
    const handler = (e: MediaQueryListEvent) => setSidebarOpen(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useSwipeDrawer(sidebarOpen, setSidebarOpen)

  const { data: profile } = useSWR<{ language: string | null }>('/api/settings/profile', fetcher)

  // Query parameter ?lang=ja|en takes highest priority (useful for demo sharing links)
  const langFromUrl = useMemo(() => {
    const p = new URLSearchParams(window.location.search).get('lang')
    return p === 'ja' || p === 'en' ? p : null
  }, [])

  const [locale, setLocaleState] = useState<Locale>(() => {
    if (langFromUrl) return langFromUrl
    const cached = localStorage.getItem('locale')
    if (cached === 'ja' || cached === 'en') return cached
    return navigator.language.startsWith('ja') ? 'ja' : 'en'
  })

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    localStorage.setItem('locale', l)
  }, [])

  useEffect(() => {
    // When ?lang= is present, persist it and skip profile override
    if (langFromUrl) {
      localStorage.setItem('locale', langFromUrl)
      return
    }
    // Only apply profile language as initial fallback — if localStorage already
    // has a valid locale the user explicitly chose, respect it.
    const cached = localStorage.getItem('locale')
    if (cached === 'ja' || cached === 'en') return
    if (profile?.language === 'ja' || profile?.language === 'en') {
      setLocale(profile.language)
    }
  }, [profile, setLocale, langFromUrl])

  const localeCtx = useMemo(() => ({ locale, setLocale }), [locale, setLocale])

  useEffect(() => {
    document.title = APP_NAME
  }, [])

  return (
    <LocaleContext.Provider value={localeCtx}>
      <TooltipProvider delayDuration={300}>
        <div className="min-h-screen bg-bg text-text">
          <FetchProgressProvider>
            <Outlet context={{ settings, sidebarOpen, setSidebarOpen }} />
          </FetchProgressProvider>
          <Toaster
            theme="system"
            duration={5000}
            position="top-right"
            richColors
            offset={{
              top: 'calc(var(--safe-area-inset-top) + 24px)',
              right: '24px',
              bottom: 'calc(var(--safe-area-inset-bottom) + 24px)',
              left: '24px',
            }}
            mobileOffset={{
              top: 'calc(var(--safe-area-inset-top) + 16px)',
              right: '16px',
              bottom: 'calc(var(--safe-area-inset-bottom) + 16px)',
              left: '16px',
            }}
          />
        </div>
      </TooltipProvider>
    </LocaleContext.Provider>
  )
}

export function useAppLayout() {
  return useOutletContext<AppLayoutContext>()
}

// Placeholder — article list pages implemented in Unit 5
function ArticleListPage() {
  const { feedId, categoryId } = useParams<{ feedId?: string; categoryId?: string }>()
  const location = useLocation()
  const { t } = useI18n()
  const isInbox = location.pathname === '/inbox'
  const isBookmarks = location.pathname === '/bookmarks'
  const isLikes = location.pathname === '/likes'
  const isHistory = location.pathname === '/history'
  const isClips = location.pathname === '/clips'

  const { data: feedsData } = useSWR<{ feeds: Array<{ id: number; name: string; type: string; category_id: number | null; category_name: string | null }>; clip_feed_id: number | null }>('/api/feeds', fetcher)
  const { data: categoriesData } = useSWR<{ categories: Array<{ id: number; name: string }> }>('/api/categories', fetcher)

  const headerName = isHistory
    ? t('feeds.history')
    : isLikes
      ? t('feeds.likes')
      : isBookmarks
        ? t('feeds.bookmarks')
        : isInbox
          ? t('feeds.inbox')
          : isClips
            ? t('feeds.clips')
            : feedId
              ? feedsData?.feeds.find(f => f.id === Number(feedId))?.name ?? null
              : categoryId
                ? categoriesData?.categories.find(c => c.id === Number(categoryId))?.name ?? null
                : null

  return (
    <PageLayout
      feedName={headerName}
    >
      {isInbox && <HintBanner storageKey="hint-dismissed-inbox">{t('hint.inbox')}</HintBanner>}
      {isBookmarks && <HintBanner storageKey="hint-dismissed-bookmarks">{t('hint.bookmarks')}</HintBanner>}
      {isLikes && <HintBanner storageKey="hint-dismissed-likes">{t('hint.likes')}</HintBanner>}
      {isHistory && <HintBanner storageKey="hint-dismissed-history">{t('hint.history')}</HintBanner>}
      {isClips && <HintBanner storageKey="hint-dismissed-clips">{t('hint.clips')}</HintBanner>}
      {/* Article list — implemented in Unit 5 */}
      <div className="p-4 text-muted text-sm">Article list coming soon (Unit 5)</div>
    </PageLayout>
  )
}

function SettingsPageWrapper() {
  return (
    <PageLayout>
      <Suspense>
        <SettingsPage />
      </Suspense>
    </PageLayout>
  )
}

function HomePageWrapper() {
  return (
    <PageLayout>
      <Suspense>
        <HomePage />
      </Suspense>
    </PageLayout>
  )
}

// Placeholder — article detail implemented in Unit 6
function ArticleDetailPage() {
  const { '*': splat } = useParams()
  if (!splat) return null
  const articleUrl = `https://${decodeURIComponent(splat)}`
  return (
    <>
      <Header mode="detail" />
      {/* Article detail — implemented in Unit 6 */}
      <div className="p-4 text-muted text-sm">
        Article detail coming soon (Unit 6) — {articleUrl}
      </div>
    </>
  )
}

/**
 * Renders nothing. Restores scroll position synchronously before browser paints.
 */
function ScrollRestore({ pathname, pageType }: { pathname: string; pageType: string }) {
  useLayoutEffect(() => {
    if (pageType === 'list') {
      restoreScrollPosition(pathname)
    }
  }, [pathname, pageType])
  return null
}

// Determine the "page type" for scroll restoration
function getPageType(pathname: string): 'detail' | 'list' {
  if (
    pathname === '/' ||
    pathname === '/inbox' ||
    pathname === '/bookmarks' ||
    pathname === '/likes' ||
    pathname === '/history' ||
    pathname === '/clips' ||
    pathname.startsWith('/feeds/') ||
    pathname.startsWith('/categories/') ||
    pathname.startsWith('/settings')
  ) {
    return 'list'
  }
  return 'detail'
}

function AppRoutes() {
  const location = useLocation()
  const isTouchDevice = useIsTouchDevice()
  const pageType = getPageType(location.pathname)

  // Save scroll position when navigating away from a page
  const prevPathname = useRef(location.pathname)
  useEffect(() => {
    if (prevPathname.current !== location.pathname) {
      saveScrollPosition(prevPathname.current)
      prevPathname.current = location.pathname
    }
  }, [location.pathname])

  void isTouchDevice // used in Unit 8 for animated transitions

  return (
    <>
      <ScrollRestore pathname={location.pathname} pageType={pageType} />
      <Routes location={location}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePageWrapper />} />
          <Route path="/inbox" element={<ArticleListPage />} />
          <Route path="/bookmarks" element={<ArticleListPage />} />
          <Route path="/likes" element={<ArticleListPage />} />
          <Route path="/history" element={<ArticleListPage />} />
          <Route path="/clips" element={<ArticleListPage />} />
          <Route path="/feeds/:feedId" element={<ArticleListPage />} />
          <Route path="/categories/:categoryId" element={<ArticleListPage />} />
          <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
          <Route path="/settings/:tab" element={<SettingsPageWrapper />} />
          <Route path="/*" element={<ArticleDetailPage />} />
        </Route>
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <SWRConfig value={{
      fetcher,
      dedupingInterval: 5000,
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      errorRetryCount: 2,
    }}>
      <BrowserRouter>
        <ErrorBoundary>
          <AuthShell>
            <AppRoutes />
          </AuthShell>
        </ErrorBoundary>
      </BrowserRouter>
    </SWRConfig>
  )
}
