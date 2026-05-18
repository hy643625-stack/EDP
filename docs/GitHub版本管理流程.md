# GitHub 版本管理流程

## 目标

这份文档用于约束 EveryDayPerfect 后续所有版本迭代流程。  
以后不再采用“临时整理文件夹”的方式，而是统一使用：

- Git 管理源码
- GitHub 管理远程版本历史
- `CHANGELOG.md` 管理版本说明
- `02-user-software` / `03-send-package` 管理本地交付物

## 统一原则

- 源码仓库只管理源码、脚本、文档、流程文件。
- 用户安装包、压缩包、日志、数据库不纳入 Git。
- 每次发版必须同时具备：
  - 版本号
  - `CHANGELOG.md`
  - Git 提交
  - Git tag
  - 安装包
  - manifest

## 仓库范围

Git 仓库根目录固定为：

```text
C:\Users\Lenovo\Desktop\EveryDayPerfect\01-source\EveryDayPerfect
```

不要把 `C:\Users\Lenovo\Desktop\EveryDayPerfect` 整个工作区直接纳入仓库。

## 分支规则

当前推荐规则：

- `main`：始终保持可发布
- `feature/*`：新功能开发
- `fix/*`：问题修复
- `release/*`：必要时用于发版整理

如果当前仍然以单人开发为主，可以长期只使用 `main`，等多人协作后再细分。

## 标准开发流程

每次日常迭代统一遵循：

```text
改代码
-> 本地验证
-> 更新版本号
-> 更新 CHANGELOG
-> 跑测试
-> 生成安装包与交付物
-> Git 提交
-> Git tag
-> 推送 GitHub
```

## Git 安全目录说明

如果仓库曾被不同账户、不同终端环境或自动化工具写入，Git 可能会报：

```text
detected dubious ownership
```

当前项目内这几个脚本已经会自动把仓库根目录注册为当前用户的 `safe.directory`：

- `tools/init_git_repo.ps1`
- `tools/create_git_release_tag.ps1`
- `tools/run_standard_release.ps1`

如果你是在命令行里手工运行 Git，仍然遇到这个报错，就先手动执行：

```powershell
git config --global --add safe.directory C:\Users\Lenovo\Desktop\EveryDayPerfect\01-source\EveryDayPerfect
```

## 标准发版流程

### 方式一：推荐，使用统一脚本

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\run_standard_release.ps1 -Part patch -Commit -Tag
```

如果确认本机代码已经准备好，并且希望发版后立即推送到 GitHub：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\run_standard_release.ps1 -Part patch -Commit -Tag -Push
```

### 方式二：手工执行

```powershell
.\set_project_version.ps1 -Part patch
.\publish_windows_release.ps1
git add .
git commit -m "release: v1.0.3"
powershell -ExecutionPolicy Bypass -File .\tools\create_git_release_tag.ps1 -Push
git push
```

## 脚本说明

- `tools/init_git_repo.ps1`
  用于初始化本地仓库、配置远程仓库。

- `tools/create_git_release_tag.ps1`
  用于创建标准版本标签，例如 `v1.0.2`。

- `tools/run_standard_release.ps1`
  用于执行标准发版流程检查、构建、提交、打标签、推送。

- `tools/git_common.ps1`
  用于统一处理 Git 可执行文件定位、`safe.directory` 注册和公共命令调用。

## 发版前强制检查

每次正式发版前必须满足：

1. `CHANGELOG.md` 已写入当前版本号对应条目
2. 本地工作区没有未确认的脏改动
3. 前端测试通过
4. 后端测试通过
5. 安装包构建成功
6. `03-send-package` 已生成 zip 与 manifest

如果其中一项不满足，本次版本不允许发给用户。

## Git 标签规范

- 统一格式：`v主版本.次版本.修订号`
- 示例：
  - `v1.0.2`
  - `v1.0.3`
  - `v1.1.0`

## 提交信息规范

推荐使用：

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `chore: ...`
- `release: v1.0.3`

## GitHub Release 规范

每次正式发版后，GitHub Release 建议上传：

- `EveryDayPerfect-<版本号>-delivery.zip`
- `EveryDayPerfect-<版本号>-manifest.json`
- 使用 `CHANGELOG.md` 自动生成的版本说明文件

当前项目已补充：

- `tools/export_release_notes.ps1`
  从 `CHANGELOG.md` 自动提取指定版本条目，生成标准版本说明。

- `tools/publish_github_release.ps1`
  使用 GitHub CLI (`gh`) 创建或更新 GitHub Release，并上传 zip、manifest。

如果本机已经安装并登录 GitHub CLI，可直接执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\publish_github_release.ps1 -Version 1.0.2 -MarkLatest
```

如果希望在标准发版流程中一并执行 GitHub Release：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\run_standard_release.ps1 -Part patch -Commit -Tag -Push -GitHubRelease
```

说明：

- `-GitHubRelease` 依赖本机已安装 `gh`
- `gh` 需先执行 `gh auth login`
- Release 说明不再手工整理，统一从 `CHANGELOG.md` 生成
- 如果涉及代理、`gh` 登录或 Release 首次创建问题，优先查看：
  `docs/GitHub发布与代理处理手册.md`

## 当前交付目录规范

- 源码：`01-source\EveryDayPerfect`
- 用户软件目录：`02-user-software\EveryDayPerfect-<版本号>`
- 对外发送目录：`03-send-package`

当前标准交付物包含：

- `EveryDayPerfect-Setup-<版本号>.exe`
- `README-user.txt`
- `release-notes.md`
- `release-manifest.json`
- `EveryDayPerfect-<版本号>-delivery.zip`
- `EveryDayPerfect-<版本号>-manifest.json`
- `EveryDayPerfect-<版本号>-release-notes.md`

## 不纳入 Git 的内容

- `.venv/`
- `dist/`
- `build/`
- `frontend/node_modules/`
- `*.db`
- `*.log`
- `ai-settings.json`
- 本地运行缓存与测试产物

## GitHub 自动化

仓库内已补充 `.github/workflows/ci.yml`，用于：

- push 到 `main`
- pull request 到 `main`

自动执行：

- 后端测试
- 前端测试
- 前端构建

## 当前仓库状态

当前项目已经：

- 初始化本地 Git 仓库
- 创建 `main` 分支
- 绑定 GitHub 仓库
- 推送远程 `main`
- 推送标签 `v1.0.2`

后续版本都必须按本文件流程执行。
