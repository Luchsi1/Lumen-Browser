import type { SVGProps } from 'react'

const P: Record<string, string> = {
  back: 'M19 12H5M11 6l-6 6 6 6',
  forward: 'M5 12h14M13 6l6 6-6 6',
  reload: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  stop: 'M6 6l12 12M18 6L6 18',
  home: 'M4 11l8-7 8 7M6 10v10h12V10',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z',
  puzzle: 'M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4h2a2 2 0 1 0 0-4H6V6h4z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z',
  shieldOff: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6zM4 4l16 16',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  warning: 'M12 4l9 16H3zM12 10v4M12 17.5h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  volume: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7',
  mute: 'M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6',
  pin: 'M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  folder: 'M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v5M14 11v5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .5a7 7 0 0 0-1.5-1L16 5l-3-1-1 2h-2L9 4 6 5l-.5 2.5a7 7 0 0 0-1.5 1L2 8l-1 3 2 1v2l-2 1 1 3 2-.5a7 7 0 0 0 1.5 1L8 21l3 1 1-2h2l1 2 3-1 .5-2.5a7 7 0 0 0 1.5-1l2 .5 1-3-2-1z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6',
  sidebar: 'M4 5h16v14H4zM15 5v14',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  incognito: 'M3 13h18M6 13l1.5-7h9L18 13M8 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM16 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  history: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4M12 8v4l3 2',
  bookmark: 'M7 4h10v16l-5-4-5 4z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M11 8v6M8 11h6',
  print: 'M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z',
  find: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  up: 'M6 15l6-6 6 6',
  tools: 'M14 6a4 4 0 0 0 5 5l-9 9a2.5 2.5 0 0 1-3.5-3.5l9-9zM15 3l2 2',
  window: 'M3 5h18v14H3zM3 9h18',
  camera: 'M4 7h4l1.5-2h5L16 7h4v12H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM6 11a6 6 0 0 0 12 0M12 17v4',
  location: 'M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  key: 'M14 10a4 4 0 1 0-3.5 4L20 14l-2 2 2 2-2 2-2-2-2 2-3-3',
  popup: 'M4 6h12v10H4zM8 20h12V10',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  sparkle: 'M12 4l1.8 4.7L18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.3z',
}

export type IconName = keyof typeof P

export function Icon({ name, size = 18, className, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const filled = name === 'star' && (rest as any).filled
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={P[name]} />
    </svg>
  )
}
