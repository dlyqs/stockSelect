import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspace } from './state/workspace'
import ErrorBoundary from './components/ErrorBoundary'
import TerminalShell from './workbench/TerminalShell'
import WorkbenchShell from './workbench/WorkbenchShell'
import { useNavigation } from './workbench/state'
export default function App(): JSX.Element {
  const terminal = useNavigation(s => s.terminal)
  const client = useQueryClient()
  useEffect(() => {
    const offAlert = window.terminal.on('alerts:open-log', () => {
      void (async () => { if (!useWorkspace.getState().hydrated) await useWorkspace.getState().hydrate(); if (useWorkspace.getState().hydrated) useWorkspace.getState().applyCommand('ALRT', null, false); useNavigation.getState().setTerminal(true) })()
    })
    const offPopout = window.terminal.on('popout:returned', payload => {
      void (async () => { if (!useWorkspace.getState().hydrated) await useWorkspace.getState().hydrate(); if (useWorkspace.getState().hydrated) useWorkspace.getState().addPanel(payload as never) })()
    })
    const offResume = window.terminal.on('system:resumed', () => { void client.invalidateQueries({queryKey:['paper-workbench']}) })
    return () => { offAlert(); offPopout(); offResume() }
  }, [client])
  return <ErrorBoundary>{terminal ? <TerminalShell onBack={() => useNavigation.getState().setTerminal(false)} /> : <WorkbenchShell />}</ErrorBoundary>
}
