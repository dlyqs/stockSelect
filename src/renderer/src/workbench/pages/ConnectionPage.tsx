import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { WorkbenchState } from '../../../../shared/paper/workbench'
import { invoke } from '../../lib/ipc'
import { nyTime } from '../state'
const reason: Record<string,string> = { UNVERIFIED:'未验证', OK:'权限检查通过', NO_KEY:'未配置凭证', PERMISSION:'权限不足，请检查凭证与数据订阅', RATE_LIMIT:'请求限流，请稍后重试', NETWORK:'网络或服务异常，请稍后重试', INVALID_RESPONSE:'响应异常，请重新检查' }
export default function ConnectionPage({ state }: { state?: WorkbenchState }): JSX.Element {
  const [key, setKey] = useState(''), [secret, setSecret] = useState('')
  const client = useQueryClient()
  const save = useMutation({ mutationFn: () => invoke('keys:set', { provider:'alpaca', key:`${key.trim()}:${secret.trim()}` }), onSuccess: async () => { setKey(''); setSecret(''); await client.invalidateQueries({ queryKey:['paper-workbench'] }) } })
  const check = useMutation({ mutationFn: () => invoke('paper:readiness'), onSuccess: () => client.invalidateQueries({ queryKey:['paper-workbench'] }) })
  return <><section className="wb-card"><h2>连接模拟行情</h2><p className="wb-muted">Alpaca raw IEX 分钟行情与资产信息，仅用于模拟。保存凭证不代表权限检查通过；检查通过也不代表当前价格实时。</p><p>{state?.configured ? '凭证已保存（不回显密钥）' : '尚未配置凭证，仍可查看历史与备份。'}</p><form onSubmit={e => { e.preventDefault(); if (!save.isPending) save.mutate() }}><div className="wb-fields"><label>API Key<input type="password" autoComplete="off" value={key} required onChange={e=>setKey(e.target.value)} /></label><label>API Secret<input type="password" autoComplete="off" value={secret} required onChange={e=>setSecret(e.target.value)} /></label></div><div className="wb-row"><button className="primary" disabled={save.isPending || check.isPending || !key.trim() || !secret.trim()}>{save.isPending ? '正在保存…' : '保存凭证'}</button><button type="button" disabled={!state?.configured || check.isPending || save.isPending} onClick={()=>check.mutate()}>{check.isPending ? '正在检查…' : '只读检查 IEX 与资产权限'}</button></div></form>{save.isSuccess && <p role="status">已保存。请单独执行权限检查。</p>}{(save.error || check.error) && <p className="wb-error" role="alert">操作未完成：{(save.error || check.error)?.message}。请检查系统加密存储或网络后重试。</p>}</section><section className="wb-card"><h2>检查结果</h2><p>IEX：{reason[state?.readiness.iex ?? 'UNVERIFIED']}</p><p>资产：{reason[state?.readiness.assets ?? 'UNVERIFIED']}</p><p className="wb-muted">{nyTime(state?.readiness.checkedAt)} · 更改凭证后需重新检查</p></section></>
}
