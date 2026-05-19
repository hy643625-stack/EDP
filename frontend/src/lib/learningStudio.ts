import type { LearningResourcePackagePayload, LearningProfilePayload } from '@/api/types'

export type LearningStudioDraft = {
  course_id: string
  conversation: string
  preferred_goal: string
  weekly_days: number
  daily_minutes: number
  profile: LearningProfilePayload | null
  resource_package: LearningResourcePackagePayload | null
}

const STORAGE_KEY = 'edp.learning.studio.v1'

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

export function loadLearningStudioDraft(): LearningStudioDraft | null {
  if (!canUseStorage()) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LearningStudioDraft>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.course_id !== 'string') return null
    if (typeof parsed.conversation !== 'string') return null
    if (typeof parsed.preferred_goal !== 'string') return null
    return {
      course_id: parsed.course_id,
      conversation: parsed.conversation,
      preferred_goal: parsed.preferred_goal,
      weekly_days: Number(parsed.weekly_days) || 4,
      daily_minutes: Number(parsed.daily_minutes) || 50,
      profile: parsed.profile ?? null,
      resource_package: parsed.resource_package ?? null
    }
  } catch {
    return null
  }
}

export function saveLearningStudioDraft(draft: LearningStudioDraft): void {
  if (!canUseStorage()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
}

export function buildLearningPackageMarkdown(payload: LearningResourcePackagePayload): string {
  const lines = [
    '# 学习智能体资源包',
    '',
    `- 课程：${payload.course.title}`,
    `- 生成时间：${payload.generated_at}`,
    `- 运行模式：${payload.mode_used === 'model' ? 'AI 模型增强' : '本地规则生成'}`,
    '',
    '## 学习画像概览',
    '',
    payload.profile.overview,
    '',
    '## 学习资源',
    ''
  ]

  for (const resource of payload.package.resources) {
    lines.push(`### ${resource.title}`, '')
    lines.push(resource.summary, '')
    lines.push(resource.content_markdown, '')
  }

  lines.push('## 学习路径', '')
  for (const stage of payload.package.learning_path) {
    lines.push(`### ${stage.title}`, '')
    lines.push(`- 目标：${stage.objective}`)
    lines.push(`- 聚焦模块：${stage.focus_modules.join('、')}`)
    lines.push(`- 学习计划：${stage.study_plan}`)
    lines.push(`- 教练提醒：${stage.coach_tip}`, '')
  }

  lines.push('## 自评面板', '')
  for (const item of payload.package.evaluation.mastery_signals) {
    lines.push(`- ${item}`)
  }
  return lines.join('\n')
}

export function buildLearningPackageFilename(payload: LearningResourcePackagePayload): string {
  const safeCourse = payload.course.title.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').slice(0, 30)
  const timePart = payload.generated_at.replace(/[:]/g, '-')
  return `学习资源包-${safeCourse}-${timePart}.md`
}
