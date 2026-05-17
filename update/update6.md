🎯 指示：重构“今日属性面板”为任务分组泳道 (Task-Based Swimlanes)
一、 核心目标 (Objective)
当前“今日属性面板”是一个无序平铺的卡片网格，导致信息过载。我们需要将其升级为**“按任务分组的视觉泳道”**，建立清晰的心智模型，同时通过消除冗余信息来给卡片“减负”。

二、 数据处理逻辑 (Data Transformation)

前端聚合计算： 接收到后端的平铺属性数组（attributes）后，前端需要编写一个计算属性（Computed Property / useMemo），按属性所属的 Task（任务）进行分组。

数据结构转换：
将 [ {attr1, task: 'test1'}, {attr2, task: 'test2'}, {attr3, task: 'test1'} ]
转换为：

JSON
{
  "test1": { "color": "#xxx", "items": [attr1, attr3] },
  "test2": { "color": "#yyy", "items": [attr2] }
}
三、 UI 渲染与布局重构 (UI & Layout)

泳道容器 (Swimlane Wrapper):

遍历上面转换好的分组数据，每一个 Task 渲染为一个独立的区块（Block）。

区块之间保持足够的垂直间距（如 margin-bottom: 32px），以形成天然的视觉断层。

泳道标题栏 (Task Header):

在每个区块的顶部，渲染该 Task 的标题。

视觉规范： 采用简洁有力的排版。最左侧是该 Task 的专属颜色标识（如实心小圆点或彩色竖线），紧接着是 Task 名称（如 test1），字体加粗，颜色采用较深的次级文本色（避免喧宾夺主）。

右侧辅助（可选）： 可以在标题栏右侧显示该组下的进度概览（如 0/2 完成）。

卡片网格 (Card Grid):

在标题栏下方，渲染属于该 Task 的属性卡片。保留现有的 CSS Grid 布局（如 grid-cols-2 或 grid-cols-3）。

四、 卡片内部的极简「减法」 (Card UI Subtraction)

⚠️ 关键修改： 既然已经在外部做好了 Task 分组，请立即从卡片内部删除所属 Task 的 Tag（即卡片左上角的 [色点] test1 标识）。

让卡片的左上角直接显示属性的名称（如 nota1, ta1），将宝贵的空间还给数据本身。