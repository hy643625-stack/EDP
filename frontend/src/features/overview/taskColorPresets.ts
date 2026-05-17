export type TaskColorPreset = {
  label: string
  value: string
}

export const TASK_COLOR_PRESETS: TaskColorPreset[] = [
  { label: '鼠尾草绿', value: '#5d9372' },
  { label: '深海蓝', value: '#2563EB' },
  { label: '霓虹紫', value: '#8B5CF6' },
  { label: '琥珀金', value: '#F59E0B' },
  { label: '岩石灰', value: '#475569' },
  { label: '海盐青', value: '#4a8d8c' },
  { label: '科技蓝', value: '#3a7bd5' },
  { label: '薄暮紫', value: '#6b73c7' },
  { label: '珊瑚橙', value: '#d97a53' },
  { label: '莓果红', value: '#b95d72' },
  { label: '蜂蜜黄', value: '#c79a3b' },
  { label: '石墨灰', value: '#556070' }
]

export const DEFAULT_TASK_COLOR = TASK_COLOR_PRESETS[0].value
