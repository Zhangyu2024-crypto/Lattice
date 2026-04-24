import { create } from 'zustand'

export interface BackendStatus {
  ready: boolean
  port: number
  token: string
  baseUrl: string
}

interface AppState {
  backend: BackendStatus
  setBackend: (status: Partial<BackendStatus>) => void

  isConnected: boolean
  setConnected: (connected: boolean) => void

  model: string
  setModel: (model: string) => void

  updateStatus: (status: Record<string, unknown>) => void
}

export const useAppStore = create<AppState>((set) => ({
  backend: { ready: false, port: 0, token: '', baseUrl: '' },
  setBackend: (status) =>
    set((s) => ({ backend: { ...s.backend, ...status } })),

  isConnected: false,
  setConnected: (connected) => set({ isConnected: connected }),

  model: 'default',
  setModel: (model) => set({ model }),

  updateStatus: (status) => {
    if (typeof status.model === 'string') {
      set({ model: status.model })
    }
  },
}))
