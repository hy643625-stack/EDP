# GitHub 版本管理流程

## 目标

这份文档用于把当前项目从“本地文件夹管理版本”升级到“GitHub 管理源码版本 + 本地交付安装包”。

管理原则：

- GitHub 只管理源码、脚本、文档和版本记录。
- `02-user-software` 和 `03-send-package` 继续作为本地交付目录，不直接纳入仓库。
- 每次发版都要有：版本号、`CHANGELOG.md`、Git tag、安装包、manifest。

## 当前项目的推荐仓库根目录

```text
C:\Users\Lenovo\Desktop\EveryDayPerfect\01-source\EveryDayPerfect
```

也就是：只把源码工程放进 Git 仓库，不把桌面工作区的上层目录整体纳入仓库。

## 分支建议

建议先用一套足够简单、便于单人迭代的分支规则：

- `main`：始终保持可发布状态
- `feature/*`：功能开发分支
- `fix/*`：问题修复分支
- `release/*`：需要时用于发版整理

如果当前阶段主要是单人开发，也可以只保留 `main`，待流程稳定后再拆分。

## 一次性初始化步骤

前提：本机已安装 Git，并且命令行可用。

1. 打开源码工程目录
2. 运行仓库初始化脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\init_git_repo.ps1 -RemoteUrl https://github.com/<你的账号>/<你的仓库>.git -InitialCommit
```

3. 如果脚本没有自动推送，再执行：

```powershell
git push -u origin main
```

## 日常开发流程

```text
改代码
-> 本地运行验证
-> 更新版本号
-> 更新 CHANGELOG
-> 跑测试
-> 构建安装包
-> 提交 Git
-> 打 tag
-> 推送 GitHub
-> 发送交付包
```

推荐命令顺序：

```powershell
.\set_project_version.ps1 -Part patch
.\publish_windows_release.ps1
git add .
git commit -m "release: v1.0.2"
powershell -ExecutionPolicy Bypass -File .\tools\create_git_release_tag.ps1 -Push
```

## 发版约定

- Git tag 统一使用：`v1.0.2`
- 提交信息建议：
  - `feat: ...`
  - `fix: ...`
  - `docs: ...`
  - `release: v1.0.2`

## GitHub Release 建议内容

每次正式发版时，建议在 GitHub Release 中上传：

- `EveryDayPerfect-1.0.2-delivery.zip`
- `EveryDayPerfect-1.0.2-manifest.json`

Release 描述可直接摘取 `CHANGELOG.md` 对应版本内容。

## 不应该进仓库的内容

- 本地虚拟环境
- 构建产物
- 用户数据库
- 日志
- AI 本地配置
- 本地 IDE 配置

这些内容已经通过 `.gitignore` 做了基础排除。

## 当前阻塞点

目前这台机器上还没有可用的 Git 命令，也没有现成的 `.git` 仓库。  
所以本轮已经先把 GitHub 管理所需的文件结构补齐，下一步只需要：

1. 安装 Git
2. 创建 GitHub 仓库
3. 运行 `tools/init_git_repo.ps1`

## 相关文件

- `CHANGELOG.md`
- `docs/版本迭代记录规范.md`
- `tools/init_git_repo.ps1`
- `tools/create_git_release_tag.ps1`
- `.github/PULL_REQUEST_TEMPLATE.md`
