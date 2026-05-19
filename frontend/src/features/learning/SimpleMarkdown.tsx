type SimpleMarkdownProps = {
  content: string
}

export function SimpleMarkdown({ content }: SimpleMarkdownProps) {
  const blocks = content.replace(/\r\n/g, '\n').split('\n')
  return (
    <div className="space-y-2 text-sm leading-6 text-slate-700">
      {blocks.map((line, index) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={`md-empty-${index}`} className="h-2" />
        if (trimmed.startsWith('### ')) {
          return <h4 key={`md-h3-${index}`} className="text-sm font-semibold text-slate-900">{trimmed.slice(4)}</h4>
        }
        if (trimmed.startsWith('## ')) {
          return <h3 key={`md-h2-${index}`} className="text-base font-semibold text-slate-900">{trimmed.slice(3)}</h3>
        }
        if (trimmed.startsWith('# ')) {
          return <h2 key={`md-h1-${index}`} className="text-lg font-semibold text-slate-900">{trimmed.slice(2)}</h2>
        }
        if (trimmed.startsWith('- ')) {
          return (
            <div key={`md-li-${index}`} className="flex gap-2">
              <span className="pt-1 text-[var(--edp-brand-strong)]">•</span>
              <span>{trimmed.slice(2)}</span>
            </div>
          )
        }
        const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/)
        if (orderedMatch) {
          return (
            <div key={`md-ol-${index}`} className="flex gap-2">
              <span className="min-w-6 font-medium text-slate-500">{orderedMatch[1]}.</span>
              <span>{orderedMatch[2]}</span>
            </div>
          )
        }
        return <p key={`md-p-${index}`}>{trimmed}</p>
      })}
    </div>
  )
}
