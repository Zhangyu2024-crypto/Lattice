import { useEffect, useMemo, useState } from 'react'
import { LogIn, LogOut, Plus } from 'lucide-react'
import Button from '../../ui/Button'
import { useLLMConfigStore } from '../../../stores/llm-config-store'
import { toast } from '../../../stores/toast-store'
import { errorMessage } from '../../../lib/error-message'
import {
  createLatticeTraceId,
  sha256Hex,
} from '../../../lib/lattice-trace'
import { USER_AGREEMENT_VERSION } from '../../../lib/user-agreement'
import {
  applyPricingToModels,
  getCachedPricingCatalog,
  getPricingCatalog,
  type PricingCatalog,
} from '../../../lib/model-pricing'
import type { LLMModel, LLMProvider } from '../../../types/llm'
import type { LlmListModelsResultPayload } from '../../../types/electron'
import {
  LATTICE_AUTH_API_KEY_REF,
  LATTICE_AUTH_PROVIDER_ID,
  connectLatticeAuthProviderModels,
  disableLatticeAuthProvider,
  upsertLatticeAuthProvider,
} from '../../../lib/lattice-auth-client'
import { publicProviderModelLabel } from '../../../lib/model-display'
import { usePrefsStore } from '../../../stores/prefs-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import ActiveModelBanner from './models/ActiveModelBanner'
import GenerationTabs from './models/GenerationTabs'
import NewProviderForm from './models/NewProviderForm'
import PricingCatalogStatus from './models/PricingCatalogStatus'
import ProviderCard from './models/ProviderCard'
import {
  CONNECT_IDLE,
  CONNECTABLE_TYPES,
  buildProviderGroups,
  isBuiltIn,
  mergeFetchedModels,
  parseModelOptionKey,
  type ConnectStatus,
} from './models/types'

// ─── Top-level tab ──────────────────────────────────────────────────────

export default function ModelsTab() {
  return (
    <div className="llm-models-root">
      <ActiveModelSection />
      <div className="llm-models-section-divider" />
      <ProvidersSection />
    </div>
  )
}

// ─── Active connection section (banner + generation tabs) ────────────────

function ActiveModelSection() {
  const providers = useLLMConfigStore((s) => s.providers)
  const agent = useLLMConfigStore((s) => s.agent)
  const updateAgentConfig = useLLMConfigStore((s) => s.updateAgentConfig)
  const resetAgentConfig = useLLMConfigStore((s) => s.resetAgentConfig)

  const groups = useMemo(() => buildProviderGroups(providers), [providers])
  const totalOptions = groups.reduce((n, g) => n + g.models.length, 0)
  const anyEnabled = providers.some((p) => p.enabled)

  // Provider/model binding is shared; reading agent config is sufficient.
  const currentProviderId = agent.providerId
  const currentModelId = agent.modelId
  const currentKey =
    currentProviderId && currentModelId
      ? `${currentProviderId}::${currentModelId}`
      : ''

  const validKeys = useMemo(() => {
    const s = new Set<string>()
    for (const g of groups) for (const o of g.models) s.add(o.key)
    return s
  }, [groups])
  const selectValue =
    currentKey && validKeys.has(currentKey) ? currentKey : ''

  const selectedSummary = useMemo(() => {
    if (!currentProviderId || !currentModelId) return null
    const provider = providers.find((p) => p.id === currentProviderId)
    if (!provider) return null
    const model = provider.models.find((m) => m.id === currentModelId)
    return {
      providerName: provider.name,
      modelLabel: model ? publicProviderModelLabel(provider, model) : currentModelId,
      providerEnabled: provider.enabled,
      modelKnown: Boolean(model),
    }
  }, [providers, currentProviderId, currentModelId])

  const handleChangeModel = (val: string) => {
    if (!val) {
      updateAgentConfig({ providerId: null, modelId: null })
      return
    }
    const parsed = parseModelOptionKey(val)
    if (!parsed) return
    updateAgentConfig({ providerId: parsed.providerId, modelId: parsed.modelId })
  }

  // Banner variant drives both the heading copy and the visual accent.
  // Explicit state > inferring from a dozen booleans at render time.
  const banner: {
    variant: 'empty' | 'needs-connect' | 'needs-pick' | 'ready' | 'stale'
    title: string
    detail: string
  } = (() => {
    if (providers.length === 0) {
      return {
        variant: 'empty',
        title: 'No connections configured',
        detail: 'Add a connection below to start using Lattice.',
      }
    }
    if (totalOptions === 0) {
      return {
        variant: 'needs-connect',
        title: 'Connection not ready yet',
        detail:
          'Click "Connect" on a connection below to finish setup.',
      }
    }
    if (currentKey && !validKeys.has(currentKey)) {
      return {
        variant: 'stale',
        title: 'Selected option is no longer available',
        detail:
          'The saved default is not in the fetched catalog. Pick a new one below.',
      }
    }
    if (!currentKey) {
      return {
        variant: 'needs-pick',
        title: 'Choose a default connection',
        detail: `${totalOptions} option${totalOptions === 1 ? '' : 's'} available across ${providers.length} connection${providers.length === 1 ? '' : 's'}.`,
      }
    }
    if (selectedSummary && (!selectedSummary.providerEnabled || !anyEnabled)) {
      return {
        variant: 'stale',
        title: 'Selected connection is disabled',
        detail: 'Enable it below, or pick another option.',
      }
    }
    return {
      variant: 'ready',
      title: 'chaxiejun.xyz is connected',
      detail: 'Lattice uses the connected account for workspace access.',
    }
  })()

  return (
    <section>
      <header className="llm-models-section-header">
        <div>
          <div className="llm-models-heading">Active connection</div>
          <div className="llm-models-subheading">
            One connection is used by default. Generation parameters are below.
          </div>
        </div>
      </header>

      <ActiveModelBanner
        variant={banner.variant}
        title={banner.title}
        detail={banner.detail}
        summary={banner.variant === 'ready' ? selectedSummary : null}
        canPick={totalOptions > 0}
        groups={groups}
        value={selectValue}
        onChange={handleChangeModel}
      />

      <GenerationTabs
        dialog={agent}
        agent={agent}
        onChangeDialog={updateAgentConfig}
        onChangeAgent={updateAgentConfig}
        onResetDialog={resetAgentConfig}
        onResetAgent={resetAgentConfig}
      />
    </section>
  )
}

// ─── Providers section ──────────────────────────────────────────────────

function ProvidersSection() {
  const providers = useLLMConfigStore((s) => s.providers)
  const updateProvider = useLLMConfigStore((s) => s.updateProvider)
  const enableProvider = useLLMConfigStore((s) => s.enableProvider)
  const removeProvider = useLLMConfigStore((s) => s.removeProvider)
  const addProvider = useLLMConfigStore((s) => s.addProvider)
  const updateAgentConfig = useLLMConfigStore((s) => s.updateAgentConfig)
  const agent = useLLMConfigStore((s) => s.agent)

  const [adding, setAdding] = useState(false)
  const [connectStatus, setConnectStatus] = useState<
    Record<string, ConnectStatus>
  >({})
  const [catalog, setCatalog] = useState<PricingCatalog | null>(() =>
    getCachedPricingCatalog(),
  )
  const [catalogRefreshing, setCatalogRefreshing] = useState(false)
  const [blogLoginRunning, setBlogLoginRunning] = useState(false)
  const [blogSession, setBlogSession] = useState<{
    authenticated: true
    baseUrl: string
    username: string
    keyPrefix: string
  } | null>(null)

  const setStatus = (id: string, next: ConnectStatus) =>
    setConnectStatus((s) => ({ ...s, [id]: next }))

  // If we have no cached catalog at all on mount, silently prime it in the
  // background. Users who never open ModelsTab still pay this fetch, but only
  // once per week (TTL) and only while the tab is open.
  useEffect(() => {
    if (catalog) return
    let cancelled = false
    getPricingCatalog()
      .then((cat) => {
        if (!cancelled) setCatalog(cat)
      })
      .catch(() => {
        // Offline / blocked — stay with `null`; the Refresh button lets the
        // user retry. Connect still succeeds, models just stay $0-priced.
      })
    return () => {
      cancelled = true
    }
  }, [catalog])

  useEffect(() => {
    let cancelled = false
    window.electronAPI?.latticeAuthGetSession?.()
      .then((session) => {
        if (cancelled) return
        setBlogSession(session.authenticated ? session : null)
      })
      .catch(() => {
        if (!cancelled) setBlogSession(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Runs the full connect flow: validate inputs → fetch catalog → merge
  // into provider.models → enable → if nothing is currently selected, pin
  // the first returned model as default. Single call the user has to make.
  const handleConnect = async (provider: LLMProvider) => {
    if (!provider.apiKey || !provider.apiKey.trim()) {
      setStatus(provider.id, { state: 'error', message: 'No API key set' })
      return
    }
    if (!provider.baseUrl || !provider.baseUrl.trim()) {
      setStatus(provider.id, { state: 'error', message: 'No base URL set' })
      return
    }
    if (!CONNECTABLE_TYPES.has(provider.type)) {
      setStatus(provider.id, {
        state: 'error',
        message: `Provider type "${provider.type}" does not expose a compatible catalog`,
      })
      return
    }
    if (
      provider.apiKey.trim() === LATTICE_AUTH_API_KEY_REF &&
      provider.id !== LATTICE_AUTH_PROVIDER_ID
    ) {
      setStatus(provider.id, {
        state: 'error',
        message: 'The signed-in chaxiejun.xyz connection cannot be reused by another provider',
      })
      return
    }
    const api = window.electronAPI
    if (!api?.llmListModels) {
      setStatus(provider.id, {
        state: 'error',
        message: 'Connecting requires the Electron desktop shell',
      })
      return
    }

    setStatus(provider.id, { state: 'running' })
    let result: LlmListModelsResultPayload
    try {
      const workspaceRootPath = useWorkspaceStore.getState().rootPath
      const acceptedConsent =
        usePrefsStore.getState().privacy.acceptedAgreementVersion ===
        USER_AGREEMENT_VERSION
      result = await api.llmListModels({
        provider: provider.type as 'anthropic' | 'openai' | 'openai-compatible',
        apiKey: provider.apiKey.trim(),
        baseUrl: provider.baseUrl.trim(),
        traceId: createLatticeTraceId(),
        module: 'agent',
        operation: 'list_models',
        workspaceIdHash: workspaceRootPath
          ? await sha256Hex(workspaceRootPath)
          : null,
        consentVersion: acceptedConsent ? USER_AGREEMENT_VERSION : null,
      })
    } catch (err) {
      setStatus(provider.id, {
        state: 'error',
        message: `IPC error: ${errorMessage(err)}`,
      })
      return
    }

    if (!result.success) {
      setStatus(provider.id, {
        state: 'error',
        message: result.error,
        status: result.status,
      })
      toast.error(`${provider.name}: ${result.error}`)
      return
    }

    if (result.models.length === 0) {
      setStatus(provider.id, {
        state: 'ok',
        durationMs: result.durationMs,
        fetched: 0,
        added: 0,
        updated: 0,
      })
      toast.warn(`${provider.name}: connected but no options were returned`)
      if (!provider.enabled) enableProvider(provider.id, true)
      return
    }

    const merged = mergeFetchedModels(
      provider.models,
      result.models,
      provider.type,
    )
    let nextModels = merged.models
    let priced = 0
    try {
      const cat = catalog ?? (await getPricingCatalog())
      if (!catalog) setCatalog(cat)
      const applied = applyPricingToModels(nextModels, cat, provider.type)
      nextModels = applied.models
      priced = applied.priced
    } catch (err) {
      // Pricing lookup is best-effort; a network failure must not break
      // the connect flow. Zero-priced models just render as $0 in Usage
      // until the user clicks "Refresh pricing" after going online.
      console.warn('[pricing] lookup failed:', errorMessage(err))
    }
    updateProvider(provider.id, { models: nextModels })
    if (!provider.enabled) enableProvider(provider.id, true)

    const currentlyValid =
      agent.providerId &&
      agent.modelId &&
      nextModels.some(
        (m) =>
          agent.providerId === provider.id && m.id === agent.modelId,
      )
    let autoPicked: LLMModel | null = null
    if (!agent.providerId || !agent.modelId) {
      autoPicked = nextModels[0] ?? null
    } else if (agent.providerId === provider.id && !currentlyValid) {
      autoPicked = nextModels[0] ?? null
    }
    if (autoPicked) {
      updateAgentConfig({
        providerId: provider.id,
        modelId: autoPicked.id,
      })
    }

    setStatus(provider.id, {
      state: 'ok',
      durationMs: result.durationMs,
      fetched: result.models.length,
      added: merged.added,
      updated: merged.updated,
    })

    const summary = [
      `${result.models.length} models`,
      merged.added > 0 ? `${merged.added} new` : null,
      priced > 0 ? `${priced} priced` : null,
      autoPicked ? `default: ${publicProviderModelLabel(provider, autoPicked)}` : null,
    ]
      .filter(Boolean)
      .join(' · ')
    toast.success(`${provider.name}: connected (${summary})`)
  }

  const handleRefreshPricing = async () => {
    setCatalogRefreshing(true)
    let cat: PricingCatalog
    try {
      cat = await getPricingCatalog({ forceRefresh: true })
    } catch (err) {
      toast.error(`Pricing refresh failed: ${errorMessage(err)}`)
      setCatalogRefreshing(false)
      return
    }
    setCatalog(cat)
    let totalPriced = 0
    let touched = 0
    for (const p of providers) {
      if (p.models.length === 0) continue
      const { models, priced } = applyPricingToModels(p.models, cat, p.type)
      if (priced > 0) {
        updateProvider(p.id, { models })
        totalPriced += priced
        touched += 1
      }
    }
    setCatalogRefreshing(false)
    if (totalPriced === 0) {
      toast.info(
        `Pricing catalog refreshed (${cat.size} entries) — no new matches.`,
      )
    } else {
      toast.success(
        `Pricing refreshed: ${totalPriced} model${totalPriced === 1 ? '' : 's'} priced across ${touched} provider${touched === 1 ? '' : 's'}`,
      )
    }
  }

  const handleSetDefault = (provider: LLMProvider, model: LLMModel) => {
    if (!provider.enabled) enableProvider(provider.id, true)
    updateAgentConfig({ providerId: provider.id, modelId: model.id })
    toast.success(`Default: ${publicProviderModelLabel(provider, model)}`)
  }

  const handleCreate = async (input: Omit<LLMProvider, 'id'>) => {
    const id = addProvider(input)
    toast.success(`Added provider "${input.name}"`)
    setAdding(false)
    // Chain: newly created + key supplied → kick off connect immediately so
    // the user lands in a ready state without a second click. addProvider's
    // setState above is synchronous, so we read the next provider list here
    // rather than waiting for the next React commit.
    if (input.apiKey && input.apiKey.trim()) {
      const created: LLMProvider = {
        id,
        name: input.name,
        type: input.type,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        enabled: input.enabled,
        models: input.models,
      }
      void handleConnect(created)
    }
  }

  const handleBlogLogin = async () => {
    const api = window.electronAPI
    if (!api?.latticeAuthLogin) {
      toast.error('Blog login requires the Electron desktop shell')
      return
    }
    setBlogLoginRunning(true)
    try {
      const result = await api.latticeAuthLogin()
      if (!result.ok) {
        toast.error(`Blog login failed: ${result.error}`)
        return
      }
      upsertLatticeAuthProvider(result)
      setBlogSession(result)
      toast.success(`Logged in as ${result.username}`)
      const connected = await connectLatticeAuthProviderModels(result)
      if (!connected.ok) {
        setStatus(connected.provider.id, {
          state: 'error',
          message: connected.message,
          status: connected.status,
        })
        const suffix = connected.status ? ` (HTTP ${connected.status})` : ''
        toast.warn(`Connection setup did not finish: ${connected.message}${suffix}`)
        return
      }
      if (connected.provider.models.length === 0) {
        setStatus(connected.provider.id, {
          state: 'ok',
          durationMs: connected.durationMs,
          fetched: 0,
          added: 0,
          updated: 0,
        })
        toast.warn('Logged in, but chaxiejun.xyz returned no available options')
        return
      }
      setStatus(connected.provider.id, {
        state: 'ok',
        durationMs: connected.durationMs,
        fetched: connected.fetched,
        added: connected.added,
        updated: connected.updated,
      })
      const summary = [
        `${connected.fetched} models`,
        connected.added > 0 ? `${connected.added} new` : null,
        connected.priced > 0 ? `${connected.priced} priced` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      toast.success(`${connected.provider.name}: connected (${summary})`)
    } catch (err) {
      toast.error(`Blog login failed: ${errorMessage(err)}`)
    } finally {
      setBlogLoginRunning(false)
    }
  }

  const handleBlogLogout = async () => {
    try {
      await window.electronAPI?.latticeAuthLogout?.()
      setBlogSession(null)
      const provider = providers.find((p) => p.id === LATTICE_AUTH_PROVIDER_ID)
      if (provider) {
        disableLatticeAuthProvider()
        setStatus(provider.id, CONNECT_IDLE)
      }
      toast.info('Logged out of Lattice Blog')
    } catch (err) {
      toast.error(`Blog logout failed: ${errorMessage(err)}`)
    }
  }

  return (
    <section>
      <header className="llm-models-section-header">
        <div>
          <div className="llm-models-heading">Connections</div>
          <div className="llm-models-subheading">
            Add a connection, enter an API key, click <strong>Connect</strong>.
            Lattice checks availability, looks up pricing, and picks a
            default for you.
          </div>
          <PricingCatalogStatus
            catalog={catalog}
            refreshing={catalogRefreshing}
            onRefresh={handleRefreshPricing}
          />
        </div>
        <div className="llm-models-header-actions">
          {blogSession ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleBlogLogout}
              leading={<LogOut size={13} />}
              title={`Logged in as ${blogSession.username}`}
            >
              Blog logout
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleBlogLogin}
              disabled={blogLoginRunning}
              leading={<LogIn size={13} />}
            >
              {blogLoginRunning ? 'Logging in…' : 'Login with blog'}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => setAdding(true)}
            disabled={adding}
            leading={<Plus size={13} />}
          >
            Add connection
          </Button>
        </div>
      </header>

      {adding && (
        <NewProviderForm
          onCancel={() => setAdding(false)}
          onSubmit={handleCreate}
        />
      )}

      <div className="llm-models-list">
        {providers.length === 0 ? (
          <div className="llm-models-empty">No connections configured yet.</div>
        ) : (
          providers.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              isCurrentDefault={
                agent.providerId === p.id
              }
              currentModelId={
                agent.providerId === p.id ? agent.modelId : null
              }
              connectStatus={connectStatus[p.id] ?? CONNECT_IDLE}
              onUpdateKey={(key) => {
                updateProvider(p.id, { apiKey: key })
                setStatus(p.id, CONNECT_IDLE)
                toast.success(`Updated API key for ${p.name}`)
              }}
              onToggleEnabled={() => {
                enableProvider(p.id, !p.enabled)
                toast.info(
                  p.enabled ? `Disabled ${p.name}` : `Enabled ${p.name}`,
                )
              }}
              onRemove={() => {
                if (isBuiltIn(p.id)) return
                // eslint-disable-next-line no-alert
                if (!window.confirm(`Remove provider "${p.name}"?`)) return
                removeProvider(p.id)
                setConnectStatus((s) => {
                  const next = { ...s }
                  delete next[p.id]
                  return next
                })
                toast.success(`Removed ${p.name}`)
              }}
              onConnect={() => handleConnect(p)}
              onSetDefault={(model) => handleSetDefault(p, model)}
            />
          ))
        )}
      </div>
    </section>
  )
}
