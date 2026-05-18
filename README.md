# EveryDayPerfect

EveryDayPerfect 是一个以 Windows 为优先环境的个人任务执行与复盘工具，覆盖任务管理、每日记录、待办、专注计时和统计分析。

## 技术栈
- 前端：Vite + React + TypeScript + Tailwind CSS
- 后端：FastAPI + SQLite
- 运行环境：Node.js 20+、Python 3.12+

## 目录结构
- `frontend/`：前端应用
- `backend/`：后端服务
- `packages/core/`：核心业务用例
- `packages/data/`：数据访问与适配层
- `packages/ui/`：通用 UI 组件
- `docs/`：运行、发布、维护文档

## Windows 快速启动
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\start_everydayperfect.ps1
```

停止服务：
```powershell
.\stop_everydayperfect.ps1
```

默认地址：
- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:18765`

## 发布与交付
- 版本记录：`CHANGELOG.md`
- 迭代规范：`docs/版本迭代记录规范.md`
- Windows 打包：`build_windows_installer.ps1`

## 开发与版本管理
- 日常开发流程：`docs/标准开发流程.md`
- GitHub 版本管理：`docs/GitHub版本管理流程.md`
- 开发交接：`docs/开发交接手册.md`
- 标准发版脚本：`tools/run_standard_release.ps1`

当前仓库的 Git 脚本会自动处理 `safe.directory` 注册。  
如果在命令行里手工执行 Git 时看到 `detected dubious ownership`，请先执行：

```powershell
git config --global --add safe.directory C:\Users\Lenovo\Desktop\EveryDayPerfect\01-source\EveryDayPerfect
```

当前标准交付会自动生成：

- `README-user.txt`
- `release-notes.md`
- `release-manifest.json`
