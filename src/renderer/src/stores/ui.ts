import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UiState {
  sidebarOpen: boolean
  sidebarView: 'explorer' | 'history'
  paletteOpen: boolean
  maxRows: number
  toggleSidebar: () => void
  setSidebarView: (v: UiState['sidebarView']) => void
  setPaletteOpen: (open: boolean) => void
  setMaxRows: (n: number) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarView: 'explorer',
      paletteOpen: false,
      maxRows: 1000,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarView: (sidebarView) => set({ sidebarView, sidebarOpen: true }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setMaxRows: (maxRows) => set({ maxRows })
    }),
    { name: 'nexo-ui', partialize: (s) => ({ sidebarOpen: s.sidebarOpen, sidebarView: s.sidebarView, maxRows: s.maxRows }) }
  )
)
