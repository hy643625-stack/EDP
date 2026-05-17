📝 指示：重构过期属性的“结算与进化”工作流 (Settlement & Evolution Workflow)
业务背景：
当任务属性到达 period_end 后，直接从前端隐藏会导致用户失去掌控感我们需要引入“待结算 (Pending Settlement)”状态，并提供进化分支

1. 数据状态扩展 (Schema Update):
在属性模型中，除了现有的状态，引入一个新的虚拟状态判断：

当 当前日期 > period_end 且该属性尚未被处理时，其状态视为 pending_review (待结算)

2. Records 页面渲染逻辑拦截:

渲染今日列表时，如果检测到某属性处于 pending_review 状态，将其强制置顶显示，并套用特殊的 UI 样式（如高亮边框或特殊底色）

卡片屏蔽常规的进度条和输入框，替换为一个操作按钮：[ 🎁 周期结束，点击结算 ]

3. 结算弹窗 (Settlement Modal) 交互逻辑:
当用户点击“结算”按钮时，弹出 Modal，提供三个核心动作流：

动作一：一键续期 (Renew):

提取该属性当前的 schedule_config

自动计算上一个周期的天数（如 30天），将 period_start 更新为今天，period_end 顺延 30 天保存并恢复活跃状态

动作二：进入修改 (Evolve):

直接调起“编辑属性”的表单（默认展开“高级周期设置”面板），鼓励用户修改 target_value 或周期规则保存后开启新周期

动作三：荣耀归档 (Archive):

将该属性的 status 字段标记为 archived

前端不再在 Records 和 Todos 中渲染它，但其历史打卡数据在 Stats 页面依然被保留计算

4. Stats 页面新增“荣誉区”:

在 Stats 页面底部增加一个区域：🎓 过往里程碑 (Archived Goals)，仅做只读展示已归档的属性及其最终生命周期的达成率