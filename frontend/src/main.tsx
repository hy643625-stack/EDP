import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import { API_BASE_URL } from './api/client'
import './index.css'

type RuntimeIssue = {
  title: string
  detail: string
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { issue: RuntimeIssue | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { issue: null }
  }

  static getDerivedStateFromError(error: unknown): { issue: RuntimeIssue } {
    const message = error instanceof Error ? error.message : String(error)
    return {
      issue: {
        title: '页面渲染失败',
        detail: message || '未知渲染错误'
      }
    }
  }

  componentDidCatch(error: unknown) {
    // Keep console output for desktop debugging.
    // eslint-disable-next-line no-console
    console.error('[RootErrorBoundary]', error)
  }

  render() {
    if (this.state.issue) {
      return <RuntimeIssuePanel issue={this.state.issue} />
    }
    return this.props.children
  }
}

function RuntimeIssuePanel({ issue }: { issue: RuntimeIssue }) {
  const [copied, setCopied] = useState(false)

  async function handleCopyDiagnostic() {
    const diagnostic = [
      `time: ${new Date().toISOString()}`,
      `title: ${issue.title}`,
      `detail: ${issue.detail}`,
      `api_base: ${API_BASE_URL}`,
      `location: ${typeof window !== 'undefined' ? window.location.href : ''}`,
      `user_agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`
    ].join('\n')

    try {
      await navigator.clipboard.writeText(diagnostic)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Ignore clipboard errors.
    }
  }

  return (
    <div className="mx-auto mt-6 w-full max-w-2xl rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
      <p className="text-sm font-semibold">{issue.title}</p>
      <p className="mt-2 break-all text-xs">{issue.detail}</p>
      <p className="mt-3 text-xs text-rose-700">请截图此页面并发送，同时可复制诊断信息。</p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
          onClick={() => window.location.reload()}
        >
          重新加载
        </button>
        <button
          type="button"
          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
          onClick={() => void handleCopyDiagnostic()}
        >
          {copied ? '已复制' : '复制诊断'}
        </button>
      </div>
    </div>
  )
}

function RuntimeGuard({ children }: { children: React.ReactNode }) {
  const [issue, setIssue] = useState<RuntimeIssue | null>(null)

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      setIssue({
        title: '运行时错误',
        detail: event.message || '未知脚本错误'
      })
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : typeof event.reason === 'string'
            ? event.reason
            : JSON.stringify(event.reason)
      setIssue({
        title: '异步错误',
        detail: reason || '未知异步错误'
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  if (issue) return <RuntimeIssuePanel issue={issue} />
  return <>{children}</>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <RuntimeGuard>
        <App />
      </RuntimeGuard>
    </RootErrorBoundary>
  </React.StrictMode>
)
