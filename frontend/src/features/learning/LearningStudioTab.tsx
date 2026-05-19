import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, BrainCircuit, Copy, Download, GraduationCap, MapPinned, Sparkles, Wand2 } from 'lucide-react'

import { api } from '@/api/client'
import type {
  LearningCourse,
  LearningProfilePayload,
  LearningResourcePackagePayload,
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
import { SimpleMarkdown } from './SimpleMarkdown'

type LearningStudioTabProps = {
  onOpenAiSettings: () => void
}

function runtimeModeLabel(modeUsed: 'local_rules' | 'model'): string {
  return modeUsed === 'model' ? 'AI 模型增强' : '本地规则生成'
}

export function LearningStudioTab({ onOpenAiSettings }: LearningStudioTabProps) {
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

  const courses = workbench?.courses ?? []
  const selectedCourse = useMemo<LearningCourse | null>(
    () => courses.find((item) => item.course_id === courseId) ?? courses[0] ?? null,
    [courses, courseId]
  )

  useEffect(() => {
    void bootstrap()
  }, [])

  useEffect(() => {
    if (!hydratedRef.current || !courseId) return
    saveLearningStudioDraft({
      course_id: courseId,
      conversation,
      preferred_goal: preferredGoal,
      weekly_days: weeklyDays,
      daily_minutes: dailyMinutes,
      profile,
      resource_package: resourcePackage
    })
  }, [courseId, conversation, preferredGoal, weeklyDays, dailyMinutes, profile, resourcePackage])

  async function bootstrap() {
    setLoadingWorkbench(true)
    try {
      const payload = await api.getLearningWorkbench()
      setWorkbench(payload)
      const draft = loadLearningStudioDraft()
      const defaultCourseId = draft?.course_id || payload.courses[0]?.course_id || ''
      setCourseId(defaultCourseId)
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
    } finally {
      setLoadingWorkbench(false)
    }
  }

  async function handleBuildProfile() {
    if (!courseId || !conversation.trim()) {
      setError('请先选择课程并输入学习描述。')
      return
    }
    setBuildingProfile(true)
    try {
      const payload = await api.buildLearningProfile({
        course_id: courseId,
        conversation,
        preferred_goal: preferredGoal,
        weekly_days: weeklyDays,
        daily_minutes: dailyMinutes
      })
      setProfile(payload)
      setError('')
    } catch (raw) {
      setError(raw instanceof Error ? raw.message : String(raw))
    } finally {
      setBuildingProfile(false)
    }
  }

  async function handleGeneratePackage() {
    if (!courseId || !conversation.trim()) {
      setError('请先填写学习描述，再生成资源包。')
      return
    }
    setBuildingPackage(true)
    try {
      const payload = await api.generateLearningResourcePackage({
        course_id: courseId,
        conversation,
        preferred_goal: preferredGoal,
        weekly_days: weeklyDays,
        daily_minutes: dailyMinutes
      })
      setProfile({
        course: payload.course,
        profile: payload.profile,
        mode_requested: payload.mode_requested,
        mode_used: payload.mode_used,
        provider_id: payload.provider_id,
        runtime_message: payload.runtime_message,
        fallback_reason: payload.fallback_reason,
        generated_at: payload.generated_at
      })
      setResourcePackage(payload)
      setError('')
    } catch (raw) {
      setError(raw instanceof Error ? raw.message : String(raw))
    } finally {
      setBuildingPackage(false)
    }
  }

  async function handleCopyPackage() {
    if (!resourcePackage) return
    await navigator.clipboard.writeText(buildLearningPackageMarkdown(resourcePackage))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  function handleExportPackage() {
    if (!resourcePackage) return
    downloadTextFile(
      buildLearningPackageMarkdown(resourcePackage),
      buildLearningPackageFilename(resourcePackage),
      'text/markdown;charset=utf-8'
    )
    setExported(true)
    window.setTimeout(() => setExported(false), 1800)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <Card className="lg:col-span-12">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="inline-flex items-center gap-2 text-base">
              <GraduationCap className="h-4 w-4 text-[var(--edp-brand-strong)]" />
              学习智能体工作台
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">基于学习画像、多智能体资源生成和学习路径规划，把当前项目扩展为可用的学习辅助入口。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" iconLeft={<Bot className="h-4 w-4" />} onClick={onOpenAiSettings}>
              AI 设置
            </Button>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
              {workbench?.runtime.runtime_message || '正在加载运行状态...'}
            </span>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">课程知识库</span>
                <select className="input-clean w-full" value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={loadingWorkbench}>
                  {courses.map((course) => (
                    <option key={course.course_id} value={course.course_id}>{course.title}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">学习目标（可选）</span>
                <input className="input-clean w-full" value={preferredGoal} onChange={(e) => setPreferredGoal(e.target.value)} placeholder="例如：期末提分 / 面试准备 / 项目落地" />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">每周可学天数</span>
                <input className="input-clean w-full" type="number" min={1} max={7} value={weeklyDays} onChange={(e) => setWeeklyDays(Number(e.target.value || 4))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">每天可投入分钟</span>
                <input className="input-clean w-full" type="number" min={10} max={300} value={dailyMinutes} onChange={(e) => setDailyMinutes(Number(e.target.value || 50))} />
              </label>
            </div>

            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">学习描述</span>
              <textarea
                className="input-clean min-h-[180px] w-full resize-y"
                value={conversation}
                onChange={(e) => setConversation(e.target.value)}
                placeholder="描述你的基础、目标、时间、困难点、喜欢的学习方式。比如：我正在准备数据结构期末，树和图总是看不懂，平时只有晚上能学 1 小时，希望多一些图解和例题。"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button iconLeft={<BrainCircuit className="h-4 w-4" />} onClick={() => void handleBuildProfile()} disabled={buildingProfile || loadingWorkbench}>
                {buildingProfile ? '正在构建画像...' : '构建学习画像'}
              </Button>
              <Button iconLeft={<Wand2 className="h-4 w-4" />} onClick={() => void handleGeneratePackage()} disabled={buildingPackage || loadingWorkbench}>
                {buildingPackage ? '正在生成资源包...' : '生成个性化资源包'}
              </Button>
              <Button variant="ghost" iconLeft={<Copy className="h-4 w-4" />} onClick={() => void handleCopyPackage()} disabled={!resourcePackage}>
                {copied ? '已复制' : '复制资源包'}
              </Button>
              <Button variant="ghost" iconLeft={<Download className="h-4 w-4" />} onClick={handleExportPackage} disabled={!resourcePackage}>
                {exported ? '已导出' : '导出 Markdown'}
              </Button>
            </div>

            {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
            {workbench?.privacy_notice ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-700">{workbench.privacy_notice}</div> : null}
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold text-slate-600">课程预览</p>
              <p className="mt-2 text-base font-semibold text-slate-900">{selectedCourse?.title || '未选择课程'}</p>
              <p className="mt-1 text-sm text-slate-500">{selectedCourse?.summary}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(selectedCourse?.tags || []).map((tag) => (
                  <span key={tag} className="rounded-full bg-white px-2.5 py-1 text-[11px] text-slate-600">{tag}</span>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {(selectedCourse?.modules || []).slice(0, 6).map((module) => (
                  <div key={module.module_id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-sm font-medium text-slate-800">{module.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{module.core_points.join(' / ')}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold text-slate-600">多智能体协同链路</p>
              <div className="mt-3 space-y-2">
                {(resourcePackage?.package.agent_runs || workbench?.agents || []).map((agent) => (
                  <div key={agent.agent_id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">{agent.name}</p>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                        {'status' in agent ? '已执行' : '待执行'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-6 text-slate-500">{'summary' in agent ? agent.summary : agent.responsibility}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {profile ? (
        <Card className="lg:col-span-12">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              学习画像
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">{profile.profile.overview}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {profile.profile.dimensions.map((dimension) => (
                <div key={dimension.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs font-semibold text-slate-500">{dimension.label}</p>
                  <p className="mt-2 text-base font-semibold text-slate-900">{dimension.value}</p>
                  <p className="mt-2 text-xs leading-6 text-slate-500">{dimension.evidence}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <InfoListCard title="优势信号" items={profile.profile.strengths} />
              <InfoListCard title="风险提醒" items={profile.profile.risks} />
              <InfoListCard title="建议追问" items={profile.profile.follow_up_questions} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {resourcePackage ? (
        <>
          <Card className="lg:col-span-12">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="inline-flex items-center gap-2">
                  <MapPinned className="h-4 w-4 text-[var(--edp-brand-strong)]" />
                  学习路径与资源包
                </CardTitle>
                <p className="mt-1 text-sm text-slate-500">{resourcePackage.package.package_overview}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs ${resourcePackage.mode_used === 'model' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-amber-200 bg-amber-50 text-amber-700'}`}>
                {runtimeModeLabel(resourcePackage.mode_used)}
              </span>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              {resourcePackage.package.learning_path.map((stage) => (
                <div key={stage.stage_id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                  <p className="text-xs font-semibold text-slate-500">{stage.title}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{stage.objective}</p>
                  <p className="mt-2 text-xs leading-6 text-slate-500">聚焦模块：{stage.focus_modules.join('、')}</p>
                  <p className="mt-2 text-xs leading-6 text-slate-500">交付物：{stage.deliverables.join('、')}</p>
                  <p className="mt-2 text-xs leading-6 text-slate-600">{stage.study_plan}</p>
                  <p className="mt-2 rounded-xl bg-white px-3 py-2 text-xs leading-6 text-slate-700">{stage.coach_tip}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-12">
            <CardHeader>
              <CardTitle>个性化资源生成结果</CardTitle>
              <p className="mt-1 text-sm text-slate-500">{resourcePackage.package.coach_message}</p>
            </CardHeader>
            <CardContent className="grid gap-4 xl:grid-cols-2">
              {resourcePackage.package.resources.map((resource) => (
                <div key={resource.resource_id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{resource.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{resource.summary}</p>
                    </div>
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">{resource.estimated_minutes} 分钟</span>
                  </div>
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <SimpleMarkdown content={resource.content_markdown} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-12">
            <CardHeader>
              <CardTitle>学习效果评估</CardTitle>
              <p className="mt-1 text-sm text-slate-500">{resourcePackage.runtime_message}</p>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              <InfoListCard title="掌握信号" items={resourcePackage.package.evaluation.mastery_signals} />
              <InfoListCard title="自检问题" items={resourcePackage.package.evaluation.self_check_questions} />
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <p className="text-sm font-semibold text-slate-900">达成等级</p>
                <div className="mt-3 space-y-2">
                  {resourcePackage.package.evaluation.rubric.map((item) => (
                    <div key={item.level} className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-sm font-medium text-slate-800">{item.level}</p>
                      <p className="mt-1 text-xs leading-6 text-slate-500">{item.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}

function InfoListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <div className="mt-3 space-y-2">
        {items.map((item, index) => (
          <div key={`${title}-${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-600">
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}
