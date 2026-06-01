import { useState } from 'react'
import { api } from '@/api/client'
import { Button, Card, CardContent, CardHeader, CardTitle } from '../../../../packages/ui/src'
import { ChevronDown, ChevronUp, Code2, ExternalLink, Lightbulb, Link, Play, Send, Tag, Trophy } from 'lucide-react'

interface CfSubmission {
  platform: string
  problem_id: string
  problem_title: string
  contest_id: string
  problem_index: string
  verdict: string
  language: string
  code: string
  submitted_at: string
  runtime_ms: number
  memory_kb: number
}

export function ContestTab() {
  const [url, setUrl] = useState('')
  const [handle, setHandle] = useState('')
  const [loadingFetch, setLoadingFetch] = useState(false)
  const [loadingDiagnose, setLoadingDiagnose] = useState(false)
  const [problem, setProblem] = useState<Record<string, unknown> | null>(null)
  const [aiReviewed, setAiReviewed] = useState(false)
  const [submissions, setSubmissions] = useState<CfSubmission[]>([])
  const [code, setCode] = useState('')
  const [verdict, setVerdict] = useState('WA')
  const [language, setLanguage] = useState('C++')
  const [diagnosis, setDiagnosis] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [showCodePanel, setShowCodePanel] = useState(false)
  const [selectedSubIdx, setSelectedSubIdx] = useState(-1)

  async function handleFetchProblem() {
    if (!url.trim()) return
    setLoadingFetch(true); setError(''); setDiagnosis(null)
    setSubmissions([]); setAiReviewed(false); setSelectedSubIdx(-1)
    try {
      const result = await api.postContestFetchProblem(url, handle.trim() || undefined)
      if (result.error) { setError(String(result.error)); return }
      setProblem((result.problem as Record<string, unknown>) || null)
      setAiReviewed(Boolean(result.ai_reviewed))
      setSubmissions((result.submissions as CfSubmission[]) || [])
      setCode('')
      setShowCodePanel(false)
    } catch (e) { setError(String(e)) }
    finally { setLoadingFetch(false) }
  }

  async function handleDiagnose() {
    if (!problem || !code.trim()) { setError('请先导入题目并输入或选择代码'); return }
    setLoadingDiagnose(true); setError('')
    try {
      const result = await api.postContestDiagnose({
        problem: { platform: problem.platform, source_url: problem.source_url, title: problem.title, tags: problem.tags },
        submission: { platform: problem.platform || 'codeforces', problem_id: problem.problem_id || '', verdict, language, code },
      })
      setDiagnosis((result.diagnosis as Record<string, unknown>) || null)
    } catch (e) { setError(String(e)) }
    finally { setLoadingDiagnose(false) }
  }

  function handleSelectSubmission(idx: number) {
    setSelectedSubIdx(idx)
    // CF user.status doesn't include code, so we can only show verdict info
    // The user still needs to paste code manually
  }

  function formatTimestamp(ts: string | number) {
    if (!ts) return ''
    const d = new Date(typeof ts === 'string' ? parseInt(ts) * 1000 : ts * 1000)
    return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function verdictBadge(v: string) {
    const map: Record<string, string> = {
      OK: 'bg-emerald-100 text-emerald-700', WRONG_ANSWER: 'bg-rose-100 text-rose-700',
      TIME_LIMIT_EXCEEDED: 'bg-amber-100 text-amber-700', RUNTIME_ERROR: 'bg-orange-100 text-orange-700',
      MEMORY_LIMIT_EXCEEDED: 'bg-purple-100 text-purple-700', COMPILATION_ERROR: 'bg-slate-100 text-slate-700',
      UNKNOWN: 'bg-slate-100 text-slate-500',
    }
    const label: Record<string, string> = {
      OK: 'AC', WRONG_ANSWER: 'WA', TIME_LIMIT_EXCEEDED: 'TLE',
      RUNTIME_ERROR: 'RE', MEMORY_LIMIT_EXCEEDED: 'MLE', COMPILATION_ERROR: 'CE',
      UNKNOWN: '?',
    }
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${map[v] || map.UNKNOWN}`}>
        {label[v] || v}
      </span>
    )
  }

  const tags = (problem?.tags as string[]) || []
  const prerequisites = (problem?.prerequisites as string[]) || []
  const educationalValue = (problem?.educational_value as string) || ''
  const hypotheses = ((diagnosis as Record<string, unknown>)?.hypotheses as Array<{ type: string; hypothesis: string; evidence: string }>) || []
  const llmEnhanced = (diagnosis as Record<string, unknown>)?.llm_enhanced as boolean

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <Card className="lg:col-span-12">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-amber-500" />竞赛训练 Agent
          </CardTitle>
          <p className="mt-1 text-sm text-slate-500">导入题目 → AI 验题入库 → 查看提交记录 → 代码诊断</p>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {/* Left: Import + Problem info */}
          <div className="space-y-3">
            {/* URL input */}
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">题目链接</span>
              <div className="flex gap-2">
                <input className="input-clean flex-1" value={url} onChange={e => setUrl(e.target.value)}
                  placeholder="https://codeforces.com/problemset/problem/4/A"
                  onKeyDown={e => e.key === 'Enter' && handleFetchProblem()} />
              </div>
            </label>

            {/* Handle input */}
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Codeforces Handle（可选，用于拉取提交记录）</span>
              <div className="flex gap-2">
                <input className="input-clean flex-1" value={handle} onChange={e => setHandle(e.target.value)}
                  placeholder="例如 tourist"
                  onKeyDown={e => e.key === 'Enter' && handleFetchProblem()} />
                <Button iconLeft={<Link className="h-4 w-4" />} onClick={() => void handleFetchProblem()} disabled={loadingFetch || !url.trim()}>
                  {loadingFetch ? '解析中...' : '导入'}
                </Button>
              </div>
            </label>

            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
            ) : null}

            {/* Problem card */}
            {problem ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{problem.title as string}</p>
                    <a href={problem.source_url as string} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline mt-0.5">
                      {problem.platform as string}:{problem.problem_id as string}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {aiReviewed ? (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                      <Lightbulb className="h-3 w-3" />AI 已审题
                    </span>
                  ) : null}
                </div>

                {/* Tags */}
                {tags.length > 0 ? (
                  <div>
                    <div className="flex items-center gap-1 mb-1.5">
                      <Tag className="h-3 w-3 text-slate-400" />
                      <span className="text-[11px] text-slate-500">算法标签</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {tags.map(t => (
                        <span key={t} className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-600 font-medium">{t}</span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Educational value */}
                {educationalValue ? (
                  <div className="rounded-lg bg-violet-50 border border-violet-100 p-2.5">
                    <span className="text-[10px] font-medium text-violet-600">学习价值</span>
                    <p className="mt-0.5 text-xs text-violet-800">{educationalValue}</p>
                  </div>
                ) : null}

                {/* Prerequisites */}
                {prerequisites.length > 0 ? (
                  <div>
                    <span className="text-[11px] text-slate-500">前置知识</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {prerequisites.map((p: string) => (
                        <span key={p} className="rounded bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[10px] text-indigo-600">{p}</span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Submissions summary */}
                {submissions.length > 0 ? (
                  <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                    <span className="text-[11px] font-medium text-slate-600">
                      提交记录 ({submissions.length} 条)
                      {handle ? <span className="text-slate-400"> — {handle}</span> : null}
                    </span>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {submissions.slice(0, 6).map((s, i) => (
                        <span key={i} className={s.verdict === 'OK' ? 'text-emerald-500' : 'text-rose-500'}>
                          {verdictBadge(s.verdict)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Expandable code analysis */}
            {problem ? (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-50 transition-colors"
                  onClick={() => setShowCodePanel(!showCodePanel)}
                >
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Play className="h-4 w-4 text-amber-500" />代码分析（可选）
                  </span>
                  {showCodePanel ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </button>
                {showCodePanel ? (
                  <div className="border-t border-slate-200 p-3 space-y-3">
                    {/* Submission selector */}
                    {submissions.length > 0 ? (
                      <div className="space-y-1">
                        <span className="text-[11px] text-slate-500">选择提交记录（仅可查看判定结果，代码需手动粘贴）</span>
                        <div className="max-h-32 overflow-y-auto space-y-1">
                          {submissions.map((s, i) => (
                            <button
                              key={i}
                              className={`w-full text-left rounded-lg border px-2.5 py-1.5 text-xs flex items-center justify-between gap-2
                                ${selectedSubIdx === i ? 'border-amber-300 bg-amber-50' : 'border-slate-150 hover:bg-slate-50'}`}
                              onClick={() => handleSelectSubmission(i)}
                            >
                              <span className="text-slate-700 truncate">{s.language}</span>
                              <span className="flex items-center gap-1.5 shrink-0">
                                {verdictBadge(s.verdict)}
                                <span className="text-[10px] text-slate-400">{formatTimestamp(s.submitted_at)}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        {handle ? '该题目暂无提交记录' : '填写 CF Handle 可拉取提交记录'}
                      </p>
                    )}

                    {/* Verdict & language */}
                    <div className="flex gap-2 flex-wrap">
                      <select className="input-clean w-auto text-xs" value={language} onChange={e => setLanguage(e.target.value)}>
                        <option>C++</option><option>Python</option><option>Java</option>
                      </select>
                      <select className="input-clean w-auto text-xs" value={verdict} onChange={e => setVerdict(e.target.value)}>
                        <option>WA</option><option>TLE</option><option>RE</option><option>AC</option><option>MLE</option><option>UNKNOWN</option>
                      </select>
                    </div>

                    {/* Code textarea */}
                    <textarea className="input-clean min-h-[180px] w-full resize-y font-mono text-sm"
                      value={code} onChange={e => setCode(e.target.value)}
                      placeholder="粘贴你的代码..." />

                    <Button iconLeft={<Play className="h-4 w-4" />} onClick={() => void handleDiagnose()} disabled={loadingDiagnose || !code.trim()}>
                      {loadingDiagnose ? '诊断中...' : 'WA 诊断'}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Right: Results */}
          <div className="space-y-3">
            {diagnosis ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-amber-700">
                    错误假设 ({hypotheses.length} 条)
                  </p>
                  {llmEnhanced ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                      <Lightbulb className="h-3 w-3" />AI 增强
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400">规则诊断</span>
                  )}
                </div>
                {hypotheses.map((h, i) => (
                  <div key={i} className="mt-2 rounded-lg bg-white border border-amber-200 p-3">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{h.type}</span>
                    <p className="mt-1 text-sm text-slate-700">{h.hypothesis}</p>
                    <p className="mt-1 text-xs text-slate-400">{h.evidence}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
                <Code2 className="h-8 w-8 mx-auto text-slate-300" />
                <p className="mt-3 text-sm text-slate-400">导入题目后，展开代码分析面板，</p>
                <p className="text-sm text-slate-400">粘贴代码并点击 WA 诊断查看结果</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
