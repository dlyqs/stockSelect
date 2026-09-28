import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { KeyStatus } from '../../../shared/types'
import { invoke } from '../lib/ipc'
import { useWorkspace } from '../state/workspace'
import TitleBar from '../components/TitleBar'
import TickerTape from '../components/TickerTape'
import CommandLine from '../components/CommandLine'
import PanelGrid from '../components/PanelGrid'
import StatusBar from '../components/StatusBar'
import FirstRunWizard from '../components/FirstRunWizard'

export default function TerminalShell({ onBack }: { onBack: () => void }): JSX.Element {
  const queryClient = useQueryClient()
  // Skipping is remembered: someone using only the keyless functions shouldn't meet the wizard every launch.
  const [skippedWizard, setSkippedWizard] = useState(() => window.localStorage.getItem('wizard-skipped') === '1')
  const hydrationError = useWorkspace((s) => s.hydrationError)
  const hydrated = useWorkspace((s) => s.hydrated)
  const hydrate = useWorkspace((s) => s.hydrate)

  useEffect(() => {
    if (!useWorkspace.getState().hydrated) void hydrate()
  }, [hydrate])

  const applyCommand = useWorkspace((s) => s.applyCommand)
  // Link-group ticker changed in another window → follow in the active panel.
  const loadTicker = useWorkspace((s) => s.loadTicker)
  useEffect(() => {
    return window.terminal.on('link:ticker', (payload) => loadTicker(payload as string))
  }, [loadTicker])

  // System woke from sleep: quotes/candles are stale — refetch what's visible.
  useEffect(() => {
    return window.terminal.on('system:resumed', () => {
      void queryClient.invalidateQueries({ queryKey: ['quote'] })
      void queryClient.invalidateQueries({ queryKey: ['candles'] })
      void queryClient.invalidateQueries({ queryKey: ['fx-pairs'] })
      void queryClient.invalidateQueries({ queryKey: ['crypto-markets'] })
    })
  }, [queryClient])

  // Apply the persisted UI scale (SET → Appearance) once at boot.
  useEffect(() => {
    const root = document.getElementById('root') as HTMLElement
    root.style.zoom = window.localStorage.getItem('ui-scale') === 'M' ? '1.12' : '1'
  }, [])

  // Dev leak harness: OT_LEAKTEST=1 npm run dev → ?leaktest=1.
  useEffect(() => {
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('leaktest')) {
      const id = window.setTimeout(() => {
        void import('../lib/devHarness').then((m) => m.runLeakHarness())
      }, 8000)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [])

  // Open a function in the first empty panel so HELP stays in view next to it.
  const setActive = useWorkspace((s) => s.setActive)
  const openBeside = (fn: string): void => {
    const empty = useWorkspace.getState().panels.findIndex((p) => p.fn === 'EMPTY')
    if (empty >= 0) setActive(empty)
    applyCommand(fn, null, false)
  }

  const keyStatus = useQuery({
    queryKey: ['key-status'],
    queryFn: () => invoke<KeyStatus[]>('keys:status')
  })

  const finnhubReady = keyStatus.data?.find((k) => k.provider === 'finnhub')?.configured ?? false
  const booting = keyStatus.isLoading || !hydrated

  return (
    <div className="flex h-full flex-col bg-term-bg text-term-text">
      <TitleBar onBack={onBack} />
      {hydrationError || keyStatus.isError ? <div className="p-4"><p>{hydrationError ?? '无法读取凭证状态'}</p><button onClick={() => { void hydrate(); void keyStatus.refetch() }}>重试</button></div> : booting ? (
        <div className="flex flex-1 items-center justify-center font-mono text-[12px] uppercase tracking-widest text-term-amber">
          OpenTerminal — booting…
        </div>
      ) : !finnhubReady && !skippedWizard ? (
        <FirstRunWizard
          onDone={() => {
            setSkippedWizard(true)
            void queryClient.invalidateQueries({ queryKey: ['key-status'] })
          }}
          onSkip={(fn) => {
            window.localStorage.setItem('wizard-skipped', '1')
            setSkippedWizard(true)
            if (fn) openBeside(fn)
          }}
        />
      ) : (
        <>
          <TickerTape />
          <CommandLine />
          <PanelGrid />
          <StatusBar />
        </>
      )}
    </div>
  )
}
