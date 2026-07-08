import type { AiMode, AiModeOption, AiProviderConfigView, AiProviderDescriptor, AiRuntimeState } from '@/api/types'
import { Button } from '../../../../packages/ui/src'

export type AiProviderConfigDraft = AiProviderConfigView & {
  api_key_input: string
  clear_api_key: boolean
}

type AiSettingsModalProps = {
  open: boolean
  loading: boolean
  saving: boolean
  testing: boolean
  modeOptions: AiModeOption[]
  selectedMode: AiMode
  providers: AiProviderDescriptor[]
  selectedProviderId: string | null
  configs: Record<string, AiProviderConfigDraft>
  runtime: AiRuntimeState | null
  privacyNotice: string
  statusMessage: string
  testMessage: string
  onClose: () => void
  onModeChange: (mode: AiMode) => void
  onProviderChange: (providerId: string) => void
  onConfigChange: (providerId: string, key: keyof AiProviderConfigDraft, value: string | number | boolean) => void
  onClearApiKey: (providerId: string) => void
  onSave: () => void
  onTest: () => void
}

function getVisibleProviders(providers: AiProviderDescriptor[], mode: AiMode): AiProviderDescriptor[] {
  if (mode === 'cloud') return providers.filter((provider) => provider.deployment === 'cloud')
  if (mode === 'local') return providers.filter((provider) => provider.deployment === 'local')
  return providers
}

export function AiSettingsModal({
  open,
  loading,
  saving,
  testing,
  modeOptions,
  selectedMode,
  providers,
  selectedProviderId,
  configs,
  runtime,
  privacyNotice,
  statusMessage,
  testMessage,
  onClose,
  onModeChange,
  onProviderChange,
  onConfigChange,
  onClearApiKey,
  onSave,
  onTest
}: AiSettingsModalProps) {
  if (!open) return null

  const visibleProviders = getVisibleProviders(providers, selectedMode)
  const selectedProvider = visibleProviders.find((provider) => provider.provider_id === selectedProviderId) ?? visibleProviders[0] ?? null
  const selectedConfig = selectedProvider ? configs[selectedProvider.provider_id] : null
  const providerStatusText = selectedConfig?.api_key_configured
    ? `已保存密钥：${selectedConfig.api_key_masked ?? '******'}`
    : '当前尚未保存 API Key'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-3 py-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="AI 设置"
    >
      <section
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-200/80 bg-white p-4 shadow-soft sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 space-y-1">
          <h3 className="text-lg font-semibold text-slate-900">AI 设置</h3>
          <p className="text-sm text-slate-500">AI 助手是可选模块即使没有配置任何模型，系统也会继续使用本地规则算法</p>
        </div>

        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2">
              <h4 className="text-sm font-semibold text-slate-900">AI 模式</h4>
              <p className="mt-1 text-xs text-slate-500">默认关闭云端 AI；失败、超时或配置异常时自动降级到本地规则算法</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {modeOptions.map((item) => {
                const active = item.mode === selectedMode
                return (
                  <button
                    key={item.mode}
                    type="button"
                    className={`rounded-2xl border px-3 py-3 text-left transition ${
                      active
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}
                    onClick={() => onModeChange(item.mode)}
                  >
                    <div className="text-sm font-semibold">{item.label}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.description}</div>
                  </button>
                )
              })}
            </div>
          </section>

          {selectedMode !== 'off' ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="mb-3 space-y-1">
                <h4 className="text-sm font-semibold text-slate-900">AI 服务商</h4>
                <p className="text-xs text-slate-500">服务商列表来自后端目录配置，可继续扩展，不需要把逻辑写死在界面中</p>
              </div>
              <select
                className="input-clean w-full"
                value={selectedProvider?.provider_id ?? ''}
                onChange={(event) => onProviderChange(event.target.value)}
              >
                {visibleProviders.map((provider) => (
                  <option key={provider.provider_id} value={provider.provider_id}>
                    {provider.label}
                  </option>
                ))}
              </select>

              {selectedProvider && selectedConfig ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-sm font-medium text-slate-900">{selectedProvider.label}</div>
                    <div className="mt-1 text-xs text-slate-500">{selectedProvider.description}</div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectedProvider.fields.map((field) => {
                      if (field.key === 'stream') {
                        return (
                          <label key={field.key} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 sm:col-span-2">
                            <div className="pr-4">
                              <div className="text-sm font-medium text-slate-900">{field.label}</div>
                              {field.help_text ? <div className="mt-1 text-xs text-slate-500">{field.help_text}</div> : null}
                            </div>
                            <input
                              type="checkbox"
                              checked={Boolean(selectedConfig.stream)}
                              onChange={(event) => onConfigChange(selectedProvider.provider_id, 'stream', event.target.checked)}
                            />
                          </label>
                        )
                      }

                      if (field.key === 'api_key') {
                        return (
                          <div key={field.key} className="space-y-2 sm:col-span-2">
                            <label className="text-xs font-medium text-slate-600">{field.label}</label>
                            <input
                              className="input-clean w-full"
                              type="password"
                              value={selectedConfig.api_key_input}
                              placeholder={selectedConfig.api_key_configured ? field.placeholder || providerStatusText : field.placeholder}
                              onChange={(event) => onConfigChange(selectedProvider.provider_id, 'api_key_input', event.target.value)}
                            />
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span>{providerStatusText}</span>
                              {selectedConfig.api_key_configured ? (
                                <button
                                  type="button"
                                  className="font-medium text-rose-500 hover:text-rose-700"
                                  onClick={() => onClearApiKey(selectedProvider.provider_id)}
                                >
                                  清空已保存密钥
                                </button>
                              ) : null}
                            </div>
                            {field.help_text ? <div className="text-xs text-slate-500">{field.help_text}</div> : null}
                          </div>
                        )
                      }

                      const value = selectedConfig[field.key as keyof AiProviderConfigDraft]
                      const isNumberField = field.input_type === 'number'

                      return (
                        <div key={field.key} className={field.key === 'base_url' || field.key === 'model_name' ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
                          <label className="text-xs font-medium text-slate-600">{field.label}</label>
                          <input
                            className="input-clean w-full"
                            type={field.input_type}
                            min={field.min_value}
                            max={field.max_value}
                            step={field.step}
                            value={String(value ?? '')}
                            placeholder={field.placeholder}
                            onChange={(event) =>
                              onConfigChange(
                                selectedProvider.provider_id,
                                field.key as keyof AiProviderConfigDraft,
                                isNumberField ? Number(event.target.value) : event.target.value
                              )
                            }
                          />
                          {field.help_text ? <div className="text-xs text-slate-500">{field.help_text}</div> : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <div className="font-medium">隐私提示</div>
              <div className="mt-1 text-xs leading-6 text-amber-800">{privacyNotice}</div>
            </div>

            {runtime ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                <div className="text-sm font-medium text-slate-900">当前策略</div>
                <div className="mt-1 text-xs leading-6 text-slate-600">{runtime.message}</div>
              </div>
            ) : null}

            {statusMessage ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{statusMessage}</div>
            ) : null}

            {testMessage ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">{testMessage}</div>
            ) : null}
          </section>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button variant="ghost" disabled={loading || saving || testing || selectedMode === 'off' || !selectedProvider} onClick={onTest}>
            {testing ? '测试中...' : '测试连接'}
          </Button>
          <Button disabled={loading || saving} onClick={onSave}>
            {saving ? '保存中...' : '保存设置'}
          </Button>
        </div>
      </section>
    </div>
  )
}
