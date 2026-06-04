import { useState, useEffect } from 'react'
import { api } from '@/api/client'
import { Button, Card, CardContent, CardHeader, CardTitle } from '../../../../packages/ui/src'
import { CheckCircle2, ChevronDown, ChevronUp, Code2, ExternalLink, Lightbulb, Link, Play, Search, Send, Tag, Terminal, Trophy, XCircle } from 'lucide-react'

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
  const [streaming, setStreaming] = useState(false)
  const [streamDeep, setStreamDeep] = useState(false)
  const [progress, setProgress] = useState<Array<{ event: string; message: string }>>([])
  const [problem, setProblem] = useState<Record<string, unknown> | null>(null)
  const [aiReviewed, setAiReviewed] = useState(false)
  const [aiAvailable, setAiAvailable] = useState(false)
  const [submissions, setSubmissions] = useState<CfSubmission[]>([])
  const [code, setCode] = useState('')
  const [verdict, setVerdict] = useState('WA')
  const [language, setLanguage] = useState('C++')
  const [diagnosis, setDiagnosis] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [showCodePanel, setShowCodePanel] = useState(false)
  const [selectedSubIdx, setSelectedSubIdx] = useState(-1)
  const [compilerInfo, setCompilerInfo] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    fetch('http://127.0.0.1:18765/v1/contest/compilers')
      .then(r => r.json())
      .then(d => { if (d.data) setCompilerInfo(d.data as Record<string, unknown>) })
      .catch(() => {})
  }, [])

  async function handleFetchProblem() {
    if (!url.trim()) return
    setLoadingFetch(true); setError(''); setDiagnosis(null)
    setSubmissions([]); setAiReviewed(false); setSelectedSubIdx(-1)
    try {
      const result = await api.postContestFetchProblem(url, handle.trim() || undefined)
      if (result.error) { setError(String(result.error)); return }
      setProblem((result.problem as Record<string, unknown>) || null)
      setAiReviewed(Boolean(result.ai_reviewed))
      setAiAvailable(result.ai_available === true)
      setSubmissions((result.submissions as CfSubmission[]) || [])
      setCode('')
      setShowCodePanel(false)
    } catch (e) { setError(String(e)) }
    finally { setLoadingFetch(false) }
  }

  async function handleDiagnose(deep = false) {
    if (!problem || !code.trim()) { setError('请先导入题目并输入或选择代码'); return }
    setStreaming(true); setStreamDeep(deep); setError(''); setDiagnosis(null)
    setProgress([{ event: 'start', message: deep ? '开始深度诊断...' : '开始诊断...' }])

    try {
      const resp = await fetch('http://127.0.0.1:18765/v1/contest/diagnose/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem: {
            platform: problem.platform, source_url: problem.source_url, title: problem.title,
            tags: problem.tags, samples: problem.samples, statement_markdown: problem.statement_markdown,
          },
          submission: { platform: problem.platform || 'codeforces', problem_id: problem.problem_id || '',
            verdict, language, code },
          deep,
        }),
      })

      if (!resp.ok) { setError('服务器错误: ' + resp.status); return }

      const reader = resp.body?.getReader()
      if (!reader) { setError('浏览器不支持流式响应'); return }
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const item = JSON.parse(line.slice(6))
            const event = item.event as string
            const data = item.data as Record<string, unknown>

            switch (event) {
              case 'sample_start':
                setProgress(p => [...p, { event, message: String(data.message || '') }])
                break
              case 'sample_result':
                setProgress(p => [...p, { event, message: `样例 ${data.index}: ${data.passed ? '✓ 通过' : '✗ 失败'}` }])
                break
              case 'llm_diagnose':
              case 'hack_generate':
              case 'hack_compile':
              case 'hack_analysis':
                setProgress(p => [...p, { event, message: String(data.message || '') }])
                break
              case 'hack_done':
                setProgress(p => [...p, { event, message: `对拍完成 (${data.round_count} 轮)` + (data.first_fail && Number(data.first_fail) > 0 ? `, 第 ${data.first_fail} 轮发现反例` : ', 未发现反例') }])
                break
              case 'hack_error':
                setProgress(p => [...p, { event, message: '对拍错误: ' + String(data.message || '') }])
                break
              case 'done':
                setDiagnosis(data)
                setProgress(p => [...p, { event, message: '诊断完成' }])
                break
              case 'error':
                setError(String(data.message || '诊断失败'))
                break
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setStreaming(false)
    }
  }

  function handleSelectSubmission(idx: number) {
    setSelectedSubIdx(idx)
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
  const sampleResults = ((diagnosis as Record<string, unknown>)?.sample_results as Array<Record<string, unknown>>) || []
  const sampleFail = (diagnosis as Record<string, unknown>)?.sample_fail as boolean
  const hackResult = (diagnosis as Record<string, unknown>)?.hack_result as Record<string, unknown> | null
  const hackAnalysis = (hackResult?.counterexample_analysis as Array<{ type: string; hypothesis: string; evidence: string }>) || []

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <Card className="lg:col-span-12">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-amber-500" />竞赛训练 Agent
          </CardTitle>
          <p className="mt-1 text-sm text-slate-500">导入题目 → AI 验题入库 → 代码诊断（样例运行 + LLM + 对拍）</p>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {/* Left: Import + Problem info */}
          <div className="space-y-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">题目链接</span>
              <div className="flex gap-2">
                <input className="input-clean flex-1" value={url} onChange={e => setUrl(e.target.value)}
                  placeholder="https://codeforces.com/problemset/problem/4/A"
                  onKeyDown={e => e.key === 'Enter' && handleFetchProblem()} />
              </div>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Codeforces Handle（可选）</span>
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
                  ) : aiAvailable ? (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                      <Lightbulb className="h-3 w-3" />AI 审题未命中
                    </span>
                  ) : null}
                </div>

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

                {educationalValue ? (
                  <div className="rounded-lg bg-violet-50 border border-violet-100 p-2.5">
                    <span className="text-[10px] font-medium text-violet-600">学习价值</span>
                    <p className="mt-0.5 text-xs text-violet-800">{educationalValue}</p>
                  </div>
                ) : null}

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

                {submissions.length > 0 ? (
                  <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                    <span className="text-[11px] font-medium text-slate-600">
                      提交记录 ({submissions.length} 条)
                    </span>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {submissions.slice(0, 6).map((s, i) => (
                        <span key={i}>{verdictBadge(s.verdict)}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* AI not configured hint */}
            {problem && !aiAvailable ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-amber-700">AI 验题不可用</p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    尚未配置 AI 服务商，无法自动生成标签、学习价值和前置知识。
                    请在「AI 设置」中配置后再导入题目。
                  </p>
                </div>
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
                    <Play className="h-4 w-4 text-amber-500" />代码分析
                  </span>
                  {showCodePanel ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </button>
                {showCodePanel ? (
                  <div className="border-t border-slate-200 p-3 space-y-3">
                    {submissions.length > 0 ? (
                      <div className="space-y-1">
                        <span className="text-[11px] text-slate-500">选择提交记录（代码需手动粘贴）</span>
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

                    <div className="flex gap-2 flex-wrap">
                      <select className="input-clean w-auto text-xs" value={language} onChange={e => setLanguage(e.target.value)}>
                        <option>C++</option><option>Python</option><option>Java</option>
                      </select>
                      <select className="input-clean w-auto text-xs" value={verdict} onChange={e => setVerdict(e.target.value)}>
                        <option>WA</option><option>TLE</option><option>RE</option><option>AC</option><option>MLE</option><option>UNKNOWN</option>
                      </select>
                    </div>

                    <textarea className="input-clean min-h-[180px] w-full resize-y font-mono text-sm"
                      value={code} onChange={e => setCode(e.target.value)}
                      placeholder="粘贴你的 C++ 代码..." />

                    {/* Compiler status */}
                    {(() => {
                      const active = (compilerInfo?.active || {}) as Record<string, string>
                      const compilers = (compilerInfo?.compilers || []) as Array<Record<string, string>>
                      return (
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                          <Terminal className="h-3 w-3" />
                          {compilerInfo?.has_compiler && active.version ? (
                            <span>编译器: <span className="text-slate-600">{active.version.split(' ').slice(0, 3).join(' ')}</span></span>
                          ) : compilerInfo?.has_compiler ? (
                            <span>编译器: <span className="text-emerald-600">已检测到 {compilers[0]?.name || ''}</span></span>
                          ) : (
                            <span className="text-rose-500">未检测到 C++ 编译器，样例运行和对拍不可用</span>
                          )}
                          <span className="text-slate-300">| 可通过环境变量 EDP_CXX_COMPILER 手动指定路径</span>
                        </div>
                      )
                    })()}

                    <div className="flex gap-2">
                      <Button iconLeft={<Play className="h-4 w-4" />} onClick={() => void handleDiagnose(false)}
                        disabled={streaming || !code.trim()}>
                        {streaming && !streamDeep ? '诊断中...' : '快速诊断'}
                      </Button>
                      <Button iconLeft={<Search className="h-4 w-4" />} onClick={() => void handleDiagnose(true)}
                        disabled={streaming || !code.trim()}>
                        {streaming && streamDeep ? '对拍中...' : '深度诊断（对拍）'}
                      </Button>
                    </div>

                    {/* Streaming progress */}
                    {streaming && progress.length > 0 ? (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-1">
                        <p className="text-xs font-medium text-blue-700 flex items-center gap-1">
                          <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                          实时进度
                        </p>
                        <div className="max-h-40 overflow-y-auto space-y-0.5">
                          {progress.map((p, i) => (
                            <p key={i} className="text-[11px] text-blue-600">
                              {p.message}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Right: Results */}
          <div className="space-y-3">
            {diagnosis ? (
              <>
                {/* Sample test results */}
                {sampleResults.length > 0 ? (
                  <div className={`rounded-xl border p-4 ${sampleFail ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
                    <p className={`text-xs font-semibold ${sampleFail ? 'text-rose-700' : 'text-emerald-700'}`}>
                      样例测试 ({sampleResults.filter((s: Record<string, unknown>) => s.passed).length}/{sampleResults.length} 通过)
                    </p>
                    {sampleResults.map((s: Record<string, unknown>) => (
                      <div key={String(s.index)} className={`mt-1.5 rounded-lg border p-2.5 text-xs ${
                        s.passed ? 'border-emerald-150 bg-white' : 'border-rose-150 bg-white'
                      }`}>
                        <div className="flex items-center gap-1.5">
                          {s.passed
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            : <XCircle className="h-3.5 w-3.5 text-rose-500" />
                          }
                          <span className="font-medium text-slate-600">样例 {String(s.index)}</span>
                        </div>
                        <div className="mt-1 grid grid-cols-3 gap-2 text-[10px]">
                          <div><span className="text-slate-400">输入</span><pre className="mt-0.5 text-slate-700 whitespace-pre-wrap">{String(s.input || '')}</pre></div>
                          <div><span className="text-slate-400">期望</span><pre className="mt-0.5 text-slate-700 whitespace-pre-wrap">{String(s.expected || '')}</pre></div>
                          <div><span className={s.passed ? 'text-emerald-500' : 'text-rose-500'}>实际</span><pre className={`mt-0.5 whitespace-pre-wrap ${s.passed ? 'text-emerald-700' : 'text-rose-700'}`}>{String(s.actual || (s.error || ''))}</pre></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Error hypotheses */}
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-amber-700">错误假设 ({hypotheses.length} 条)</p>
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

                {/* Hack / 对拍 results */}
                {hackResult ? (
                  <div className={`rounded-xl border p-4 ${hackResult.first_fail && Number(hackResult.first_fail) > 0 ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
                    <p className="text-xs font-semibold text-slate-700">
                      深度对拍 ({String(hackResult.round_count)} 轮)
                    </p>

                    {hackResult.error ? (
                      <p className="mt-1 text-xs text-rose-600">{String(hackResult.error)}</p>
                    ) : null}

                    {hackResult.first_fail && Number(hackResult.first_fail) > 0 ? (
                      <div className="mt-2 space-y-2">
                        <div className="rounded-lg bg-white border border-rose-200 p-3 text-xs">
                          <span className="font-medium text-rose-600">第 {String(hackResult.first_fail)} 轮发现反例</span>
                          <pre className="mt-1.5 text-slate-700 whitespace-pre-wrap bg-slate-50 p-2 rounded max-h-24 overflow-y-auto">{String(hackResult.counterexample_input || '')}</pre>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-lg bg-white border border-rose-150 p-2.5">
                            <span className="font-medium text-rose-600">WA 输出</span>
                            <pre className="mt-1 text-rose-700 whitespace-pre-wrap">{String(hackResult.wa_output || '')}</pre>
                          </div>
                          <div className="rounded-lg bg-white border border-emerald-150 p-2.5">
                            <span className="font-medium text-emerald-600">正确输出</span>
                            <pre className="mt-1 text-emerald-700 whitespace-pre-wrap">{String(hackResult.brute_output || '')}</pre>
                          </div>
                        </div>

                        {/* LLM analysis of counterexample */}
                        {hackAnalysis.length > 0 ? (
                          <div className="rounded-lg bg-violet-50 border border-violet-200 p-3">
                            <span className="text-[10px] font-medium text-violet-600">AI 反例分析</span>
                            {hackAnalysis.map((a: { type: string; hypothesis: string; evidence: string }, i: number) => (
                              <div key={i} className="mt-2 rounded bg-white border border-violet-150 p-2.5">
                                <span className="text-[10px] px-1 py-0.5 rounded bg-violet-100 text-violet-700">{a.type}</span>
                                <p className="mt-1 text-xs text-slate-700">{a.hypothesis}</p>
                                <p className="mt-0.5 text-[10px] text-slate-400">{a.evidence}</p>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {/* Brute + generator code previews */}
                        <details className="text-xs">
                          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">查看暴力解 & 生成器代码</summary>
                          <div className="mt-2 space-y-2">
                            <div>
                              <span className="font-medium text-slate-500">暴力解 (brute.cpp)</span>
                              <pre className="mt-1 text-[10px] text-slate-600 bg-slate-100 p-2 rounded max-h-40 overflow-y-auto">{String(hackResult.brute_code || '')}</pre>
                            </div>
                            <div>
                              <span className="font-medium text-slate-500">数据生成器 (gen.cpp)</span>
                              <pre className="mt-1 text-[10px] text-slate-600 bg-slate-100 p-2 rounded max-h-40 overflow-y-auto">{String(hackResult.generator_code || '')}</pre>
                            </div>
                          </div>
                        </details>
                      </div>
                    ) : (
                      hackResult.ok && !hackResult.error ? (
                        <p className="mt-1 text-xs text-slate-500">对拍 {String(hackResult.round_count)} 轮未发现反例，代码可能在小数据范围内正确。建议扩大测试规模或检查 I/O 格式。</p>
                      ) : null
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
                <Code2 className="h-8 w-8 mx-auto text-slate-300" />
                <p className="mt-3 text-sm text-slate-400">导入题目后，展开代码分析面板</p>
                <p className="text-sm text-slate-400">粘贴代码并点击诊断按钮</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
