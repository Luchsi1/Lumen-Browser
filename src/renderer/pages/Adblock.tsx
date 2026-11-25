import { useEffect, useState } from 'react'
import { invoke, timeAgo, useRemote, useSettings } from '../common/api.ts'
import { Icon } from '../common/icons.tsx'
import { PageShell, Section, SettingRow, Toggle, guard, toast } from './shared.tsx'
import type { AdblockStatus } from '../../shared/types.ts'

export function AdblockPage() {
  return <PageShell title="Ad blocker" icon="shield"><AdblockSummary /></PageShell>
}

export function AdblockSummary() {
  const [s, update] = useSettings()
  const [st, reload] = useRemote<AdblockStatus>('adblock:status', [], ['adblock:changed', 'settings:changed'])
  const [rules, setRules] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [updatingAll, setUpdatingAll] = useState(false)
  const [allowInput, setAllowInput] = useState('')
  useEffect(() => { if (s && rules === null) setRules(s.adblock.customRules) }, [s, rules])
  if (!s || !st) return null
  const a = s.adblock
  const set = (patch: Partial<typeof a>) => guard(update({ adblock: patch }))
  const statusOf = (id: string) => st.statuses.find((x) => x.id === id)

  return (
    <>
      <Section title="Protection">
        <SettingRow label="Ad blocker" hint={st.ready ? `${st.totalRules.toLocaleString()} rules active (${st.networkRules.toLocaleString()} network, ${st.cosmeticRules.toLocaleString()} cosmetic). ${st.sessionBlocked.toLocaleString()} requests blocked this session.` : 'Loading filter lists...'}>
          <Toggle label="Ad blocker" checked={a.enabled} onChange={(v) => invoke('adblock:setGlobal', v)} /></SettingRow>
        <SettingRow label="Hide page elements (cosmetic filtering)" hint="Removes empty ad frames and placeholders that network blocking leaves behind."><Toggle label="Cosmetic filtering" checked={a.cosmetic} onChange={(v) => set({ cosmetic: v })} /></SettingRow>
        <SettingRow label="Block pop-ups" hint="Stops windows that scripts open without a click or key press, and pop-ups to blocked domains."><Toggle label="Block pop-ups" checked={a.popupBlocking} onChange={(v) => set({ popupBlocking: v })} /></SettingRow>
        <SettingRow label="Block redirects to blocked sites" hint="Stops a page from sending you to an address on the block lists."><Toggle label="Block redirects" checked={a.redirectBlocking} onChange={(v) => set({ redirectBlocking: v })} /></SettingRow>
        <SettingRow label="Strict mode: block third-party scripts and frames" hint="Blocks scripts and frames from other sites unless a rule allows them. Stops more trackers but breaks many sites, so use the per-site switch in the shield menu when needed."><Toggle label="Strict mode" checked={a.strictThirdParty} onChange={(v) => set({ strictThirdParty: v })} /></SettingRow>
      </Section>

      <Section title="Filter lists" description="Lists use the EasyList and uBlock Origin filter syntax. Security lists also block pages that are known to spread malware or phishing.">
        <div className="list">
          {a.lists.map((l) => {
            const x = statusOf(l.id)
            return (
              <div className="item" key={l.id} style={{ alignItems: 'flex-start', paddingTop: 12, paddingBottom: 12 }}>
                <Toggle label={`Enable ${l.name}`} checked={l.enabled} onChange={(v) => guard(invoke('adblock:toggleList', l.id, v).then(reload))} />
                <div className="grow">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className="title">{l.name}</span><span className={`chip ${l.category === 'security' ? 'bad' : ''}`}>{l.category}</span>
                    {l.category === 'privacy' && !s.trackingProtection && <span className="chip warn">off: tracking protection is disabled</span>}</div>
                  <div className="sub">{l.description ?? l.url}</div>
                  <div className="sub">{x?.updating ? 'Updating...' : x?.lastUpdated ? `${x.ruleCount.toLocaleString()} rules, updated ${timeAgo(x.lastUpdated)}` : 'Not downloaded yet'}</div>
                  {x?.error && <div className="sub" style={{ color: 'var(--danger)' }}>Last update failed: {x.error}{x.lastUpdated ? ' (still using the previous copy)' : ''}</div>}
                </div>
                <button className="icon-btn" title="Update this list" aria-label={`Update ${l.name}`} disabled={x?.updating} onClick={() => guard(invoke('adblock:updateList', l.id).then(reload))}><Icon name="refresh" size={16} /></button>
                {!l.builtin && <button className="icon-btn" title="Remove list" aria-label={`Remove ${l.name}`} onClick={() => guard(invoke('adblock:removeList', l.id).then(reload))}><Icon name="trash" size={16} /></button>}
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Add a custom list">
        <form className="srow stack" onSubmit={async (e) => {
          e.preventDefault(); setAdding(true)
          const r = await guard(invoke('adblock:addList', newName, newUrl.trim()), 'List added')
          setAdding(false); if (r) { setNewName(''); setNewUrl(''); reload() }
        }}>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(120px, 1fr) minmax(200px, 2fr) auto' }}>
            <input className="field" placeholder="Name" aria-label="List name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="field" placeholder="https://example.com/filters.txt" aria-label="List URL" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} required type="url" />
            <button className="btn primary" disabled={adding || !newUrl}>{adding ? 'Downloading...' : 'Add list'}</button>
          </div>
        </form>
      </Section>

      <Section title="Updates">
        <SettingRow label="Update filter lists automatically"><Toggle label="Automatic updates" checked={a.autoUpdate} onChange={(v) => set({ autoUpdate: v })} /></SettingRow>
        <SettingRow label="Check for updates"><select className="field" value={a.updateIntervalHours} disabled={!a.autoUpdate} onChange={(e) => set({ updateIntervalHours: Number(e.target.value) })}>
          <option value={6}>Every 6 hours</option><option value={12}>Every 12 hours</option><option value={24}>Every day</option><option value={72}>Every 3 days</option><option value={168}>Every week</option></select></SettingRow>
        <SettingRow label="Update now" hint={`Last successful update: ${st.lastUpdate ? new Date(st.lastUpdate).toLocaleString() : 'never'}. New rules apply immediately, no restart needed.`}>
          <button className="btn primary" disabled={updatingAll} onClick={async () => { setUpdatingAll(true); await guard(invoke('adblock:updateAll'), 'Filter lists updated'); setUpdatingAll(false); reload() }}>{updatingAll ? 'Updating...' : 'Update all lists'}</button></SettingRow>
      </Section>

      <Section title="Your rules" description="One rule per line, in uBlock Origin / Adblock Plus syntax. Examples: ||ads.example.com^  or  example.com##.banner  or  @@||example.com^$document">
        <div className="srow stack">
          <textarea className="rules" spellCheck={false} aria-label="Custom filter rules" value={rules ?? ''} onChange={(e) => setRules(e.target.value)} placeholder="! comments start with an exclamation mark" />
          {st.customRuleErrors.length > 0 && <div className="issue error" role="alert"><Icon name="warning" size={15} /><div><b>{st.customRuleErrors.length} rule{st.customRuleErrors.length === 1 ? ' is' : 's are'} not supported and ignored:</b><div className="logbox" style={{ marginTop: 4 }}>{st.customRuleErrors.slice(0, 20).join('\n')}</div></div></div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={rules === a.customRules} onClick={async () => { await guard(invoke('adblock:setCustomRules', rules ?? ''), 'Rules saved'); reload() }}>Save rules</button>
            <button className="btn" onClick={async () => { const r = await guard(invoke('adblock:importRules')); if (typeof r === 'string') { setRules(r); toast('Rules imported') } }}>Import...</button>
            <button className="btn" onClick={async () => { const p = await guard(invoke('adblock:exportRules')); if (p) toast(`Saved to ${p}`) }}>Export...</button>
          </div>
        </div>
      </Section>

      <Section title="Allowlist" description="The ad blocker is turned off on these sites and their subdomains.">
        <form className="srow" onSubmit={(e) => { e.preventDefault(); if (allowInput.trim()) { guard(invoke('adblock:allowAdd', allowInput)); setAllowInput('') } }}>
          <input className="field" style={{ maxWidth: 'none' }} placeholder="example.com" aria-label="Site to allow" value={allowInput} onChange={(e) => setAllowInput(e.target.value)} /><button className="btn">Add site</button>
        </form>
        {a.allowlist.length === 0 && <div className="srow"><span className="muted">No sites are allowed. Use the shield menu on any page to pause protection for that site.</span></div>}
        {a.allowlist.map((d) => <div className="srow" key={d}><div className="srow-text">{d}</div><button className="btn" onClick={() => invoke('adblock:allowRemove', d)}>Remove</button></div>)}
      </Section>
    </>
  )
}
