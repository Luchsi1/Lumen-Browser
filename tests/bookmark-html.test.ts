import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBookmarksHtml, importTree, exportBookmarksHtml } from '../src/main/bookmark-html.ts'
import type { Bookmark } from '../src/shared/types.ts'

const CHROME = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1600000000">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://a.example/?x=1&amp;y=2" ADD_DATE="1600000001">A &amp; B</A>
        <DT><H3>Nested</H3>
        <DL><p>
            <DT><A HREF="https://deep.example/">Deep</A>
        </DL><p>
        <DT><A HREF="javascript:alert(1)">evil</A>
    </DL><p>
    <DT><A HREF="https://top.example/">Top</A>
</DL><p>`

test('parses folders, nesting, entities', () => {
  const tree = parseBookmarksHtml(CHROME)
  assert.equal(tree.length, 2)
  const bar = tree[0]
  assert.equal(bar.title, 'Bookmarks bar')
  assert.equal(bar.children![0].title, 'A & B')
  assert.equal(bar.children![0].url, 'https://a.example/?x=1&y=2')
  assert.equal(bar.children![1].title, 'Nested')
  assert.equal(bar.children![1].children![0].url, 'https://deep.example/')
  assert.equal(tree[1].url, 'https://top.example/')
})

test('import drops javascript: urls and keeps structure', () => {
  let n = 0
  const { rows, skipped } = importTree(parseBookmarksHtml(CHROME), 'other', () => `id${++n}`)
  assert.equal(skipped, 1)
  assert.ok(!rows.some((r) => r.url?.startsWith('javascript:')))
  const nested = rows.find((r) => r.title === 'Nested')!
  assert.equal(rows.find((r) => r.title === 'Deep')!.parentId, nested.id)
})

test('export then import round trips', () => {
  const rows: Bookmark[] = [
    { id: 'f', type: 'folder', parentId: null, title: 'Dev <tools>', createdAt: 1000000, index: 0 },
    { id: 'b1', type: 'bookmark', parentId: 'f', title: 'Say "hi" & bye', url: 'https://x.example/?a=1&b=2', createdAt: 2000000, index: 0 },
    { id: 'b2', type: 'bookmark', parentId: null, title: 'Root', url: 'https://r.example/', createdAt: 3000000, index: 1 },
  ]
  const html = exportBookmarksHtml(rows)
  const tree = parseBookmarksHtml(html)
  assert.equal(tree[0].title, 'Dev <tools>')
  assert.equal(tree[0].children![0].title, 'Say "hi" & bye')
  assert.equal(tree[0].children![0].url, 'https://x.example/?a=1&b=2')
  assert.equal(tree[1].url, 'https://r.example/')
})
