import { createContext, useContext } from 'react'
import { useFetchProgress } from '../hooks/use-fetch-progress'

type FetchProgressValue = ReturnType<typeof useFetchProgress>

const FetchProgressContext = createContext<FetchProgressValue | null>(null)

export function FetchProgressProvider({ children }: { children: React.ReactNode }) {
  const value = useFetchProgress()
  return <FetchProgressContext.Provider value={value}>{children}</FetchProgressContext.Provider>
}

export function useFetchProgressContext() {
  const ctx = useContext(FetchProgressContext)
  if (!ctx) throw new Error('useFetchProgressContext must be used within FetchProgressProvider')
  return ctx
}
