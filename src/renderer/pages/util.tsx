import type { MouseEvent } from 'react'
import { invoke } from '../common/api.ts'
import { isPanel } from './shared.tsx'

/** Opens a link. In the side panel, links open in a tab so the panel stays visible. */
export function openLink(e: MouseEvent, url: string) {
  if (isPanel || e.ctrlKey || e.metaKey || e.button === 1) { e.preventDefault(); invoke('nav:go', url, { newTab: true }) }
}
