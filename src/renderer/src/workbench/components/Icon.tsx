import type { SVGProps } from 'react'

const paths = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  strategies: 'M4 17V7 M10 20V4 M16 16V8 M22 19V5',
  instruments: 'M12 3 3 8l9 5 9-5-9-5Z M3 12l9 5 9-5 M3 16l9 5 9-5',
  compare: 'M4 3v17h17 M8 15l4-5 4 3 5-7',
  data: 'M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3 M8 3v5h5 M8 3l5 5 M8 13h5 M8 17h8 M16 7l2 2 4-5',
  settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4 M12 17h.01',
  terminal: 'm5 6 6 6-6 6 M13 18h6',
  plus: 'M12 5v14 M5 12h14',
  arrow: 'M4 12h16 m-6-6 6 6-6 6',
  chevron: 'm9 5 7 7-7 7',
  activity: 'M2 12h5l3-8 4 16 3-8h5',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z m-4 9 3 3 5-6',
  check: 'm5 12 4 4L19 6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
  connection: 'M8 12h8 M7 8H5a4 4 0 0 0 0 8h2 M17 8h2a4 4 0 0 1 0 8h-2',
  alert: 'm12 3 10 18H2L12 3Z M12 9v5 M12 17h.01',
} as const

export type IconName = keyof typeof paths

export default function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }): JSX.Element {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>
}
