import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

type MarkdownRendererProps = {
  content: string
}

const components = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="text-lg font-semibold text-slate-900 mt-4 mb-3 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="text-base font-semibold text-slate-900 mt-4 mb-2">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="text-sm font-semibold text-slate-900 mt-3 mb-1.5">{children}</h3>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="text-sm leading-6 text-slate-700 my-2">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="list-disc pl-5 my-2 space-y-1 text-sm leading-6 text-slate-700">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="list-decimal pl-5 my-2 space-y-1 text-sm leading-6 text-slate-700">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="text-sm leading-6 text-slate-700">{children}</li>
  ),
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const isInline = !className?.includes('language-')
    if (isInline) {
      return <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[13px] text-slate-800 font-normal">{children}</code>
    }
    return <code className="text-[13px] text-slate-100">{children}</code>
  },
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="bg-slate-900 text-slate-100 text-[13px] rounded-xl p-4 my-3 overflow-x-auto">
      {children}
    </pre>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="border-l-[3px] border-[var(--edp-brand-strong)] bg-slate-50 py-2 px-4 rounded-r-xl my-3 text-sm text-slate-600">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className="bg-slate-50">{children}</thead>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border border-slate-200 px-3 py-2 text-left font-medium text-slate-800">{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border border-slate-200 px-3 py-2 text-slate-600">{children}</td>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} className="text-[var(--edp-brand-strong)] hover:underline" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-slate-900">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className="italic text-slate-600">{children}</em>
  ),
  hr: () => <hr className="border-slate-200 my-4" />,
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="MarkdownRenderer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
