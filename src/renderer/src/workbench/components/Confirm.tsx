import { useEffect, useRef, type ReactNode } from 'react'
export default function Confirm({ title, children, onConfirm, onClose, busy = false }: { title: string; children: ReactNode; onConfirm: () => void; onClose: () => void; busy?: boolean }): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement; ref.current?.showModal(); return () => { previous?.focus() } }, [])
  return <dialog ref={ref} aria-labelledby="confirm-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}><h2 id="confirm-title">{title}</h2>{children}<div className="wb-row"><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy} onClick={onConfirm}>{busy ? '正在处理…' : '确认'}</button></div></dialog>
}
