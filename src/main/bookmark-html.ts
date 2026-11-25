// Netscape bookmark file format (what Chrome, Edge and Firefox import/export). No Electron imports.
import type { Bookmark } from '../shared/types.ts'

export interface ParsedNode { type: 'bookmark' | 'folder'; title: string; url?: string; addDate?: number; children?: ParsedNode[] }

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Parse a bookmarks HTML export into a tree. Unknown markup is ignored. */
export function parseBookmarksHtml(html: string): ParsedNode[] {
  const root: ParsedNode = { type: 'folder', title: '', children: [] }
  const stack: ParsedNode[] = [root]
  let pendingFolder: ParsedNode | null = null
  const tokenRe = /<(\/?)(DL|H3|A|DT|P)\b([^>]*)>|([^<]+)/gi
  let m: RegExpExecArray | null
  let capture: { kind: 'h3' | 'a'; node: ParsedNode } | null = null
  while ((m = tokenRe.exec(html))) {
    const [, closing, tagRaw, attrs, text] = m
    const tag = tagRaw?.toUpperCase()
    if (text !== undefined) {
      if (capture) capture.node.title += decode(text)
      continue
    }
    if (tag === 'H3' && !closing) {
      const node: ParsedNode = { type: 'folder', title: '', children: [] }
      stack[stack.length - 1].children!.push(node)
      pendingFolder = node
      capture = { kind: 'h3', node }
    } else if (tag === 'H3' && closing) capture = null
    else if (tag === 'A' && !closing) {
      const href = /HREF\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]
      const add = /ADD_DATE\s*=\s*"(\d+)"/i.exec(attrs)?.[1]
      if (href !== undefined) {
        const node: ParsedNode = { type: 'bookmark', title: '', url: decode(href), addDate: add ? Number(add) * 1000 : undefined }
        stack[stack.length - 1].children!.push(node)
        capture = { kind: 'a', node }
      }
    } else if (tag === 'A' && closing) {
      if (capture?.kind === 'a' && !capture.node.title) capture.node.title = capture.node.url ?? ''
      capture = null
    } else if (tag === 'DL' && !closing) {
      if (pendingFolder) { stack.push(pendingFolder); pendingFolder = null }
      else if (stack.length === 1 && root.children!.length === 0) { /* outermost DL */ }
      else stack.push(stack[stack.length - 1])
    } else if (tag === 'DL' && closing) {
      if (stack.length > 1) stack.pop()
    }
  }
  return root.children!
}

const SAFE_IMPORT_SCHEMES = /^(https?|ftp|file):/i

/** Flatten a parsed tree into Bookmark rows below `parentId`. Dangerous schemes such as javascript: are dropped. */
export function importTree(nodes: ParsedNode[], parentId: string, newId: () => string, now = Date.now()): { rows: Bookmark[]; skipped: number } {
  const rows: Bookmark[] = []
  let skipped = 0
  const walk = (list: ParsedNode[], parent: string) => {
    list.forEach((n, index) => {
      if (n.type === 'folder') {
        const id = newId()
        rows.push({ id, type: 'folder', parentId: parent, title: n.title || 'Folder', createdAt: n.addDate ?? now, index })
        walk(n.children ?? [], id)
      } else if (n.url && SAFE_IMPORT_SCHEMES.test(n.url)) {
        rows.push({ id: newId(), type: 'bookmark', parentId: parent, title: n.title || n.url, url: n.url, createdAt: n.addDate ?? now, index })
      } else skipped++
    })
  }
  walk(nodes, parentId)
  return { rows, skipped }
}

export function exportBookmarksHtml(all: Bookmark[]): string {
  const children = (pid: string | null) => all.filter((b) => b.parentId === pid).sort((a, b) => a.index - b.index)
  const out: string[] = []
  const emit = (pid: string | null, depth: number) => {
    const pad = '    '.repeat(depth)
    out.push(`${pad}<DL><p>`)
    for (const b of children(pid)) {
      const date = Math.floor(b.createdAt / 1000)
      if (b.type === 'folder') {
        out.push(`${pad}    <DT><H3 ADD_DATE="${date}">${encode(b.title)}</H3>`)
        emit(b.id, depth + 2)
      } else out.push(`${pad}    <DT><A HREF="${encode(b.url ?? '')}" ADD_DATE="${date}">${encode(b.title)}</A>`)
    }
    out.push(`${pad}</DL><p>`)
  }
  out.push('<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>')
  emit(null, 0)
  return out.join('\n') + '\n'
}
