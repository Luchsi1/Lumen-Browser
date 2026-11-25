import { invoke } from '../common/api.ts'
import type { OverlayRequest } from '../../shared/types.ts'

export function openOverlay(kind: OverlayRequest['kind'], anchor: HTMLElement | DOMRect | null, opts: Partial<OverlayRequest> & { width?: number; height?: number } = {}) {
  const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor ?? new DOMRect(0, 0, 0, 0)
  return invoke('overlay:show', {
    kind,
    anchor: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    align: 'right', width: 340, height: 400, ...opts,
  } satisfies OverlayRequest)
}
