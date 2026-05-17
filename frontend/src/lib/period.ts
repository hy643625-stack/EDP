export function formatPeriodLabel(start: string | null | undefined, end: string | null | undefined): string {
  const startText = start?.trim() || ''
  const endText = end?.trim() || ''
  if (!startText && !endText) return '不限'
  if (startText && !endText) return `${startText} 之后`
  if (!startText && endText) return `${endText} 之前`
  return `${startText} ~ ${endText}`
}
