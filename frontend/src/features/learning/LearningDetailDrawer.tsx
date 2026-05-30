import type { ReactNode } from 'react'
import { X } from 'lucide-react'

type LearningDetailDrawerProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function LearningDetailDrawer({ open, onClose, title, children }: LearningDetailDrawerProps) {
  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer — desktop: right slide, mobile: bottom sheet */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl
        max-sm:inset-x-0 max-sm:top-auto max-sm:max-h-[85vh] max-sm:rounded-t-2xl
        flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-semibold text-slate-900 truncate">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body — independent scroll */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </>
  )
}
