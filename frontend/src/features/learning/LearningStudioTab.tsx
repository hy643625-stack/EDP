import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, BrainCircuit, ChevronDown, ChevronRight, ClipboardList, Copy, Download, GraduationCap, LayoutDashboard, MapPinned, MessageSquare, PlusCircle, Sparkles, Wand2 } from 'lucide-react'

import { api } from '@/api/client'
import type {
  LearningAgentRun,
  LearningCourse,
  LearningProfilePayload,
  LearningResourceCard,
  LearningResourcePackagePayload,
  LearningTutorResponse,
  LearningWorkbenchPayload
} from '@/api/types'
import { downloadTextFile } from '@/lib/ai'
import {
  buildLearningPackageFilename,
  buildLearningPackageMarkdown,
  loadLearningStudioDraft,
  saveLearningStudioDraft
} from '@/lib/learningStudio'
import { Button, Card, CardContent, CardHeader, CardTitle } from '../../../../packages/ui/src'
import { LearningDetailDrawer } from './LearningDetailDrawer'
import { InteractiveCaseLab } from './InteractiveCaseLab'
import { InteractivePracticePanel } from './InteractivePracticePanel'
import { InteractiveReviewSheet } from './InteractiveReviewSheet'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ResourceTile } from './ResourceTile'

type LearningStudioTabProps = {
  onOpenAiSettings: () => void
}

type DetailContent = {
  title: string
  type: 'resource' | 'profile' | 'path-stage' | 'evaluation'
  data: unknown
}

type ViewTab = 'overview' | 'resources' | 'path' | 'evaluation'

const TABS: { key: ViewTab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: '总览', icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
  { key: 'resources', label: '资源', icon: <Sparkles className="h-3.5 w-3.5" /> },
  { key: 'path', label: '路径', icon: <MapPinned className="h-3.5 w-3.5" /> },
  { key: 'evaluation', label: '评估', icon: <ClipboardList className="h-3.5 w-3.5" /> },
]

function runtimeModeLabel(modeUsed: 'local_rules' | 'model'): string {
  return modeUsed === 'model' ? 'AI 模型增强' : '本地规则生成'
}

function agentStatusColor(status: string) {
  return status === 'completed' ? 'bg-emerald-400' : status === 'fallback' ? 'bg-amber-400' : status === 'failed' ? 'bg-rose-400' : 'bg-slate-300'
}

export function LearningStudioTab({ onOpenAiSettings }: LearningStudioTabProps) {
  // ── Core state ──
  const [workbench, setWorkbench] = useState<LearningWorkbenchPayload | null>(null)
  const [courseId, setCourseId] = useState('')
  const [conversation, setConversation] = useState('')
  const [preferredGoal, setPreferredGoal] = useState('')
  const [weeklyDays, setWeeklyDays] = useState(4)
  const [dailyMinutes, setDailyMinutes] = useState(50)
  const [profile, setProfile] = useState<LearningProfilePayload | null>(null)
  const [resourcePackage, setResourcePackage] = useState<LearningResourcePackagePayload | null>(null)
  const [loadingWorkbench, setLoadingWorkbench] = useState(true)
  const [buildingProfile, setBuildingProfile] = useState(false)
  const [buildingPackage, setBuildingPackage] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [exported, setExported] = useState(false)
  const hydratedRef = useRef(false)

  // ── Phase 2: Session state ──
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [profileVersion, setProfileVersion] = useState<number>(0)
  const [sessionTitle, setSessionTitle] = useState<string>('')
  const [agentRuns, setAgentRuns] = useState<LearningAgentRun[]>([])

  // ── Phase 4: UI state ──
  const [activeView, setActiveView] = useState<ViewTab>('overview')
  const [drawer, setDrawer] = useState<DetailContent | null>(null)
  const [showModules, setShowModules] = useState(false)
  const [showAgents, setShowAgents] = useState(false)
  const [tutorQuestion, setTutorQuestion] = useState('')
  const [tutorResult, setTutorResult] = useState<LearningTutorResponse | null>(null)
  const [tutorLoading, setTutorLoading] = useState(false)

  // ── Derived ──
  const courses = workbench?.courses ?? []
  const selectedCourse = useMemo<LearningCourse | null>(
    () => courses.find((item) => item.course_id === courseId) ?? courses[0] ?? null,
    [courses, courseId]
  )
  const completed = agentRuns.filter(a => a.status === 'completed').length
  const fallbackCount = agentRuns.filter(a => a.status === 'fallback').length

  // ── Lifecycle ──
  useEffect(() => { void bootstrap() }, [])
  useEffect(() => {
    if (!hydratedRef.current || !courseId) return
    saveLearningStudioDraft({ course_id: courseId, conversation, preferred_goal: preferredGoal, weekly_days: weeklyDays, daily_minutes: dailyMinutes, profile, resource_package: resourcePackage })
  }, [courseId, conversation, preferredGoal, weeklyDays, dailyMinutes, profile, resourcePackage])

  async function bootstrap() {
    setLoadingWorkbench(true)
    try {
      const payload = await api.getLearningWorkbench()
      setWorkbench(payload)
      const draft = loadLearningStudioDraft()
      setCourseId(draft?.course_id || payload.courses[0]?.course_id || '')
      setConversation(draft?.conversation || '我正在准备这门课，希望系统根据我的基础、时间和目标，为我生成更适合我的学习资源与学习路径。')
      setPreferredGoal(draft?.preferred_goal || '')
      setWeeklyDays(draft?.weekly_days || 4)
      setDailyMinutes(draft?.daily_minutes || 50)
      setProfile(draft?.profile || null)
      setResourcePackage(draft?.resource_package || null)
      hydratedRef.current = true
      setError('')
    } catch (raw) {
      setError(raw instanceof Error ? raw.message : String(raw))
    } finally { setLoadingWorkbench(false) }
  }

  function resetSession() {
    setSessionId(null); setProfileVersion(0); setSessionTitle('')
    setAgentRuns([]); setProfile(null); setResourcePackage(null)
    setActiveView('overview'); setTutorResult(null)
  }

  // ── API handlers ──
  async function handleBuildProfile() {
    if (!courseId || !conversation.trim()) { setError('请先选择课程并输入学习描述。'); return }
    setBuildingProfile(true)
    try {
      const result = await api.createLearningSession({
        course_id: courseId, conversation, preferred_goal: preferredGoal, weekly_days: weeklyDays, daily_minutes: dailyMinutes,
        title: `${selectedCourse?.title || '学习'} - ${new Date().toLocaleDateString('zh-CN')}`,
      })
      setSessionId(result.session?.id || null)
      setProfileVersion(result.profile_version || 1)
      setSessionTitle(result.session?.title || '')
      setProfile({
        course: result.course, profile: result.profile,
        mode_requested: result.mode_requested as LearningProfilePayload['mode_requested'],
        mode_used: (result.mode_used || 'local_rules') as LearningProfilePayload['mode_used'],
        provider_id: result.provider_id, runtime_message: result.runtime_message,
        fallback_reason: result.fallback_reason, generated_at: result.generated_at,
      })
      setActiveView('overview')
      setError('')
    } catch (raw) { setError(raw instanceof Error ? raw.message : String(raw)) }
    finally { setBuildingProfile(false) }
  }

  async function handleGeneratePackage() {
    if (!courseId || !conversation.trim()) { setError('请先填写学习描述，再生成资源包。'); return }
    setBuildingPackage(true)
    try {
      let payload: LearningResourcePackagePayload
      if (sessionId) payload = await api.generateSessionResourcePackage(sessionId)
      else payload = await api.generateLearningResourcePackage({ course_id: courseId, conversation, preferred_goal: preferredGoal, weekly_days: weeklyDays, daily_minutes: dailyMinutes })
      setProfile({
        course: payload.course, profile: payload.profile,
        mode_requested: payload.mode_requested, mode_used: payload.mode_used,
        provider_id: payload.provider_id, runtime_message: payload.runtime_message,
        fallback_reason: payload.fallback_reason, generated_at: payload.generated_at,
      })
      setResourcePackage(payload)
      const runs = (payload as unknown as Record<string, unknown>).agent_runs
      if (Array.isArray(runs)) setAgentRuns(runs as LearningAgentRun[])
      if (payload.package?.agent_runs?.length) setAgentRuns(payload.package.agent_runs as LearningAgentRun[])
      setActiveView('resources')
      setTutorResult(null)
      setError('')
    } catch (raw) { setError(raw instanceof Error ? raw.message : String(raw)) }
    finally { setBuildingPackage(false) }
  }

  async function handleCopyPackage() {
    if (!resourcePackage) return
    await navigator.clipboard.writeText(buildLearningPackageMarkdown(resourcePackage))
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }

  function handleExportPackage() {
    if (!resourcePackage) return
    downloadTextFile(buildLearningPackageMarkdown(resourcePackage), buildLearningPackageFilename(resourcePackage), 'text/markdown;charset=utf-8')
    setExported(true); setTimeout(() => setExported(false), 1800)
  }

  async function handleTutorSubmit() {
    const q = tutorQuestion.trim()
    if (!q || !sessionId) return
    setTutorLoading(true)
    try {
      const res = await api.tutorLearningSession(sessionId, q)
      setTutorResult(res)
    } catch (raw) { setError(raw instanceof Error ? raw.message : String(raw)) }
    finally { setTutorLoading(false) }
  }

  // ── Detail openers ──
  function openResourceDetail(r: LearningResourceCard) {
    setDrawer({ title: r.title, type: 'resource', data: r })
  }
  function openProfileDetail() {
    if (!profile) return
    setDrawer({ title: '画像详情', type: 'profile', data: profile.profile })
  }
  function openPathDetail(stageIdx: number) {
    if (!resourcePackage) return
    const stage = resourcePackage.package.learning_path[stageIdx]
    if (stage) setDrawer({ title: stage.title, type: 'path-stage', data: stage })
  }
  function openEvaluationDetail() {
    if (!resourcePackage) return
    setDrawer({ title: '评估详情', type: 'evaluation', data: resourcePackage.package.evaluation })
  }

  // ── Render ──
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* Session bar */}
      {sessionId ? (
        <div className="lg:col-span-12 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700">当前会话</span>
            <span className="text-sm font-medium text-slate-800">{sessionTitle}</span>
            <span className="text-xs text-slate-500">画像 v{profileVersion}</span>
          </div>
          <Button variant="ghost" size="sm" iconLeft={<PlusCircle className="h-4 w-4" />} onClick={resetSession}>新建会话</Button>
        </div>
      ) : null}

      {/* Input card */}
      <Card className="lg:col-span-12">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="inline-flex items-center gap-2 text-base"><GraduationCap className="h-4 w-4 text-[var(--edp-brand-strong)]" />学习智能体工作台</CardTitle>
            <p className="mt-1 text-sm text-slate-500">基于学习画像、多智能体资源生成和学习路径规划。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" iconLeft={<Bot className="h-4 w-4" />} onClick={onOpenAiSettings}>AI 设置</Button>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">{workbench?.runtime.runtime_message || '加载中...'}</span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1"><span className="text-xs font-medium text-slate-600">课程知识库</span>
                <select className="input-clean w-full" value={courseId} onChange={e => setCourseId(e.target.value)} disabled={loadingWorkbench}>
                  {courses.map(c => <option key={c.course_id} value={c.course_id}>{c.title}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="text-xs font-medium text-slate-600">学习目标（可选）</span>
                <input className="input-clean w-full" value={preferredGoal} onChange={e => setPreferredGoal(e.target.value)} placeholder="例如：期末提分 / 面试准备" />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1"><span className="text-xs font-medium text-slate-600">每周可学天数</span>
                <input className="input-clean w-full" type="number" min={1} max={7} value={weeklyDays} onChange={e => setWeeklyDays(Number(e.target.value || 4))} />
              </label>
              <label className="space-y-1"><span className="text-xs font-medium text-slate-600">每天可投入分钟</span>
                <input className="input-clean w-full" type="number" min={10} max={300} value={dailyMinutes} onChange={e => setDailyMinutes(Number(e.target.value || 50))} />
              </label>
            </div>
            <label className="space-y-1"><span className="text-xs font-medium text-slate-600">学习描述</span>
              <textarea className="input-clean min-h-[140px] w-full resize-y" value={conversation} onChange={e => setConversation(e.target.value)}
                placeholder="描述你的基础、目标、时间、困难点、喜欢的学习方式。" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button iconLeft={<BrainCircuit className="h-4 w-4" />} onClick={() => void handleBuildProfile()} disabled={buildingProfile || loadingWorkbench}>
                {buildingProfile ? '构建中...' : '构建学习画像'}
              </Button>
              <Button iconLeft={<Wand2 className="h-4 w-4" />} onClick={() => void handleGeneratePackage()} disabled={buildingPackage || loadingWorkbench}>
                {buildingPackage ? '生成中...' : '生成个性化资源包'}
              </Button>
              <Button variant="ghost" iconLeft={<Copy className="h-4 w-4" />} onClick={() => void handleCopyPackage()} disabled={!resourcePackage}>{copied ? '已复制' : '复制'}</Button>
              <Button variant="ghost" iconLeft={<Download className="h-4 w-4" />} onClick={handleExportPackage} disabled={!resourcePackage}>{exported ? '已导出' : '导出'}</Button>
            </div>
            {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
          </div>

          {/* Right panel: course preview (collapsed) + agent status (collapsed) */}
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <button onClick={() => setShowModules(!showModules)} className="flex items-center justify-between w-full text-left">
                <span className="text-xs font-semibold text-slate-600">{selectedCourse?.title || '未选择'} · {selectedCourse?.module_count || 0} 模块</span>
                {showModules ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              </button>
              {showModules ? (
                <div className="mt-3 space-y-2">
                  {(selectedCourse?.modules || []).map(m => (
                    <div key={m.module_id} className="rounded-xl border border-slate-200 bg-white p-2.5">
                      <p className="text-sm font-medium text-slate-800">{m.title}</p>
                      <p className="text-xs text-slate-500">{m.core_points?.join(' / ')}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <button onClick={() => setShowAgents(!showAgents)} className="flex items-center justify-between w-full text-left">
                <span className="text-xs font-semibold text-slate-600">智能体链路 · {completed}/{agentRuns.length || (workbench?.agents || []).length} 完成</span>
                {showAgents ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              </button>
              {!showAgents ? (
                <div className="mt-2 flex gap-1">
                  {(agentRuns.length > 0 ? agentRuns : (workbench?.agents || [])).map((a, i) => (
                    <span key={`${a.agent_id}-${i}`} className={`h-2 w-5 rounded-full ${'status' in a ? agentStatusColor(a.status) : 'bg-slate-300'}`} />
                  ))}
                </div>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {(agentRuns.length > 0 ? agentRuns : (workbench?.agents || [])).map((a, i) => (
                    <div key={`${a.agent_id}-${i}`} className="flex items-center justify-between text-xs text-slate-500">
                      <span>{'name' in a ? a.name : a.agent_id}</span>
                      <span className={`inline-block w-2 h-2 rounded-full ${'status' in a ? agentStatusColor(a.status) : 'bg-slate-300'}`} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile summary */}
      {profile ? (
        <Card className="lg:col-span-12">
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-500" />学习画像
                {profileVersion > 0 ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">v{profileVersion}</span> : null}
              </CardTitle>
              <p className="mt-1 text-sm text-slate-500 line-clamp-1">{profile.profile.overview}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={openProfileDetail}>详情</Button>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 grid-cols-4 md:grid-cols-8">
              {profile.profile.dimensions.map(d => (
                <div key={d.key} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-center">
                  <p className="text-[11px] text-slate-500">{d.label}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-800 line-clamp-1">{d.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Four-view tabs + content */}
      {resourcePackage ? (
        <>
          {/* Tab bar */}
          <div className="lg:col-span-12 flex gap-1 border-b border-slate-200 pb-0">
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => setActiveView(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-t-lg transition-colors
                  ${activeView === tab.key ? 'bg-white border border-b-white border-slate-200 -mb-px text-[var(--edp-brand-strong)] font-medium' : 'text-slate-500 hover:text-slate-700'}`}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          {/* ── OVERVIEW ── */}
          {activeView === 'overview' ? (
            <Card className="lg:col-span-12">
              <CardContent className="pt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="资源数量" value={`${resourcePackage.package.resource_count} 个`} />
                <StatCard label="学习阶段" value={`${resourcePackage.package.learning_path.length} 阶段`} />
                <StatCard label="智能体完成" value={`${completed}/${agentRuns.length}`} />
                <StatCard label="今日推荐" value={`${resourcePackage.package.recommendations?.today_resources?.length || 0} 个`} />
                {resourcePackage.package.recommendations?.next_action ? (
                  <div className="sm:col-span-2 lg:col-span-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium text-slate-500">下一步建议</p>
                    <p className="mt-1 text-sm text-slate-700">{resourcePackage.package.recommendations.next_action}</p>
                  </div>
                ) : null}
                {resourcePackage.package.recommendations?.risk_adjustments?.length ? (
                  <div className="sm:col-span-2 lg:col-span-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-xs font-medium text-amber-600">风险提醒</p>
                    {resourcePackage.package.recommendations.risk_adjustments.map((r, i) => (
                      <p key={i} className="mt-1 text-sm text-amber-700">· {r}</p>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* ── RESOURCES ── */}
          {activeView === 'resources' ? (
            <div className="lg:col-span-12 grid gap-4">
              {/* Tutor entry */}
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare className="h-4 w-4 text-indigo-500" />
                  <span className="text-sm font-medium text-indigo-700">智能辅导</span>
                </div>
                {!sessionId ? (
                  <p className="text-xs text-slate-500">请先点击「构建学习画像」创建会话后使用智能辅导。</p>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <input className="input-clean flex-1" value={tutorQuestion} onChange={e => setTutorQuestion(e.target.value)}
                        placeholder="输入学习问题，如：时间复杂度怎么学？" onKeyDown={e => e.key === 'Enter' && handleTutorSubmit()} />
                      <Button size="sm" onClick={() => void handleTutorSubmit()} disabled={tutorLoading || !tutorQuestion.trim()}>
                        {tutorLoading ? '...' : '提问'}
                      </Button>
                    </div>
                    {tutorResult ? (
                      <div className="mt-3 rounded-xl bg-white border border-indigo-200 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${tutorResult.confidence >= 0.5 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            置信度 {Math.round(tutorResult.confidence * 100)}%
                          </span>
                          <span className="text-xs text-slate-400">{tutorResult.related_resources.length} 关联资源</span>
                        </div>
                        <MarkdownRenderer content={tutorResult.answer_markdown} />
                        {tutorResult.related_resources.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {tutorResult.related_resources.map(rr => (
                              <button key={rr.resource_id}
                                onClick={() => {
                                  const full = resourcePackage?.package.resources.find(f => f.resource_id === rr.resource_id)
                                  if (full) openResourceDetail(full)
                                }}
                                className="text-left rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 hover:border-indigo-300 hover:bg-indigo-50 transition-colors">
                                <p className="text-xs font-medium text-slate-700">{rr.title}</p>
                                <p className="text-[11px] text-slate-400 line-clamp-1">{rr.summary}</p>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {/* Resource tiles */}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {resourcePackage.package.resources.map(r => (
                  <ResourceTile key={r.resource_id} type={r.type} title={r.title} summary={r.summary}
                    estimatedMinutes={r.estimated_minutes} sourceRefs={r.source_refs}
                    safetyPassed={r.safety_review?.grounding_passed} onClick={() => openResourceDetail(r)} />
                ))}
              </div>
            </div>
          ) : null}

          {/* ── PATH ── */}
          {activeView === 'path' ? (
            <Card className="lg:col-span-12">
              <CardContent className="pt-4 grid gap-4 lg:grid-cols-3">
                {resourcePackage.package.learning_path.map((stage, idx) => (
                  <div key={stage.stage_id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 cursor-pointer hover:border-slate-300" onClick={() => openPathDetail(idx)}>
                    <p className="text-xs font-semibold text-slate-500">{stage.title}</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{stage.objective}</p>
                    <p className="mt-2 text-xs text-slate-500">交付物 {stage.deliverables.length} 个
                      {stage.recommended_resource_ids ? ` · 推荐资源 ${stage.recommended_resource_ids.length} 个` : ''}
                    </p>
                    {stage.priority_reason ? <p className="mt-2 text-xs text-slate-400 italic">{stage.priority_reason}</p> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {/* ── EVALUATION ── */}
          {activeView === 'evaluation' ? (
            <Card className="lg:col-span-12">
              <CardContent className="pt-4 grid gap-4 sm:grid-cols-3">
                <StatCard label="掌握信号" value={`${resourcePackage.package.evaluation.mastery_signals.length} 条`} />
                <StatCard label="自检问题" value={`${resourcePackage.package.evaluation.self_check_questions.length} 条`} />
                <StatCard label="达成等级" value={resourcePackage.package.evaluation.rubric.map(r => r.level).join(' / ')} />
              </CardContent>
              <div className="px-4 pb-4">
                <Button variant="ghost" size="sm" onClick={openEvaluationDetail}>查看完整评估</Button>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {/* ── Detail Drawer ── */}
      <LearningDetailDrawer open={!!drawer} onClose={() => setDrawer(null)} title={drawer?.title || ''}>
        {drawer?.type === 'resource' ? (() => {
          const r = drawer.data as LearningResourceCard
          const hasInteraction = r.interaction?.kind
          const isInteractiveType = r.type === 'practice_pack' || r.type === 'case_lab' || r.type === 'review_sheet'
          return (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">{r.summary}</p>
              {r.source_refs?.length ? (
                <div className="flex flex-wrap gap-1">
                  {r.source_refs.map(ref => (
                    <span key={ref} className={`rounded-full px-2 py-0.5 text-[10px] ${ref.startsWith('module:') ? 'bg-blue-50 text-blue-600 border border-blue-200' : ref.startsWith('source:') ? 'bg-purple-50 text-purple-600 border border-purple-200' : 'bg-slate-100 text-slate-500'}`}>{ref}</span>
                  ))}
                </div>
              ) : null}
              {isInteractiveType && !hasInteraction ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                  当前资源包未包含交互数据，可能是旧缓存或旧版本生成的内容，请重新生成资源包后再查看交互。
                </div>
              ) : null}
              {hasInteraction === 'practice_pack' ? <InteractivePracticePanel resource={r} /> :
               hasInteraction === 'case_lab' ? <InteractiveCaseLab resource={r} /> :
               hasInteraction === 'review_sheet' ? <InteractiveReviewSheet resource={r} /> : null}
              {hasInteraction ? (
                <details className="mt-4">
                  <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">完整说明 (Markdown)</summary>
                  <div className="mt-2"><MarkdownRenderer content={r.content_markdown} /></div>
                </details>
              ) : (
                <MarkdownRenderer content={r.content_markdown} />
              )}
              {r.safety_review ? (
                <div className={`rounded-lg p-3 text-xs ${r.safety_review.grounding_passed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                  {r.safety_review.grounding_passed ? '内容可溯源' : 'grounding 未通过'}
                  {r.safety_review.warnings?.length ? <span className="ml-2 text-amber-600">({r.safety_review.warnings.length} 告警)</span> : null}
                </div>
              ) : null}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" iconLeft={<Copy className="h-4 w-4" />} onClick={() => { navigator.clipboard.writeText(r.content_markdown); setCopied(true); setTimeout(() => setCopied(false), 1800) }}>复制内容</Button>
              </div>
            </div>
          )
        })() : drawer?.type === 'profile' ? (() => {
          const p = drawer.data as LearningProfilePayload['profile']
          return (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">{p.overview}</p>
              <div className="space-y-3">
                {p.dimensions.map(d => (
                  <div key={d.key} className="rounded-xl border border-slate-200 p-3">
                    <p className="text-xs font-semibold text-slate-500">{d.label} · 置信度 {(d.confidence * 100).toFixed(0)}%</p>
                    <p className="mt-1 text-sm font-medium text-slate-800">{d.value}</p>
                    <p className="mt-1 text-xs text-slate-500">{d.evidence}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <InfoBlock title="优势信号" items={p.strengths} />
                <InfoBlock title="风险提醒" items={p.risks} />
                <InfoBlock title="建议追问" items={p.follow_up_questions} />
              </div>
            </div>
          )
        })() : drawer?.type === 'path-stage' ? (() => {
          const s = drawer.data as Record<string, unknown>
          return (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">{s.objective as string}</p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-medium text-slate-500">学习计划</p><p className="mt-1 text-sm text-slate-700">{s.study_plan as string}</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-medium text-slate-500">教练提醒</p><p className="mt-1 text-sm text-slate-700">{s.coach_tip as string}</p>
              </div>
              {(s.focus_modules as string[])?.length ? <InfoBlock title="聚焦模块" items={s.focus_modules as string[]} /> : null}
              {(s.deliverables as string[])?.length ? <InfoBlock title="交付物" items={s.deliverables as string[]} /> : null}
            </div>
          )
        })() : drawer?.type === 'evaluation' ? (() => {
          const ev = drawer.data as Record<string, unknown>
          return (
            <div className="space-y-4">
              <InfoBlock title="掌握信号" items={ev.mastery_signals as string[]} />
              <InfoBlock title="自检问题" items={ev.self_check_questions as string[]} />
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-600">达成等级</p>
                {(ev.rubric as Array<{ level: string; description: string }>)?.map(item => (
                  <div key={item.level} className="rounded-xl border border-slate-200 p-3">
                    <p className="text-sm font-medium text-slate-800">{item.level}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )
        })() : null}
      </LearningDetailDrawer>
    </div>
  )
}

/* ── Micro components ── */

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-800">{value}</p>
    </div>
  )
}

function InfoBlock({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <div className="mt-2 space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{item}</div>
        ))}
      </div>
    </div>
  )
}
