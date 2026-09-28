import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WorkbenchState } from '../../../../shared/paper/workbench'
import { invoke } from '../../lib/ipc'
export function usePaper() {
  return useQuery({ queryKey: ['paper-workbench'], queryFn: () => invoke<WorkbenchState>('paper:workbench'), refetchInterval: 8000, refetchIntervalInBackground: false, refetchOnWindowFocus: true })
}
export function usePaperAction() {
  const client = useQueryClient()
  return useMutation({ mutationKey: ['paper-action'], mutationFn: (payload: unknown) => invoke<{ id: string } | undefined>('paper:action', payload), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['paper-workbench'] }),client.invalidateQueries({ queryKey: ['paper-state'] }),client.invalidateQueries({ queryKey: ['paper-page'] }),client.invalidateQueries({ queryKey: ['paper-history'] }),client.invalidateQueries({ queryKey: ['paper-compare'] })]) } })
}
