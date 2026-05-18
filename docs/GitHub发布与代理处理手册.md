# GitHub 发布与代理处理手册

这份文档专门记录 EveryDayPerfect 在 Windows 环境下进行 GitHub 推送、GitHub CLI 登录、Release 发布时的标准步骤与常见问题处理。

适用场景：

- `git push` 连不上 GitHub
- 已经能打开 GitHub 网页，但命令行无法推送
- `gh` 已安装但 `auth status` 显示未登录
- 首次创建 GitHub Release
- 需要给后续维护者留下可直接照做的操作记录

## 1. 当前使用到的工具

- Git：`D:\Git\bin\git.exe`
- GitHub CLI：`C:\Program Files\GitHub CLI\gh.exe`
- 源码目录：
  `C:\Users\Lenovo\Desktop\EveryDayPerfect\01-source\EveryDayPerfect`

## 2. 标准操作顺序

建议按下面顺序执行：

1. 本地完成代码修改
2. 本地跑测试
3. 生成安装包和交付物
4. `git commit`
5. `git push`
6. 确认 `gh auth status`
7. 发布 GitHub Release

## 3. Git 推送标准命令

在源码目录执行：

```powershell
D:\Git\bin\git.exe push origin main
```

如果本地有 tag 需要单独推送：

```powershell
D:\Git\bin\git.exe push origin v1.0.2
```

## 4. GitHub CLI 标准命令

### 4.1 查看版本

```powershell
& 'C:\Program Files\GitHub CLI\gh.exe' --version
```

### 4.2 检查登录状态

```powershell
& 'C:\Program Files\GitHub CLI\gh.exe' auth status
```

### 4.3 登录 GitHub CLI

```powershell
& 'C:\Program Files\GitHub CLI\gh.exe' auth login --hostname github.com --git-protocol https --web
```

## 5. GitHub Release 发布命令

发布当前版本：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\tools\publish_github_release.ps1 -Version 1.0.2 -MarkLatest
```

如果以后要随着标准发版流程一并执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\run_standard_release.ps1 -Part patch -Commit -Tag -Push -GitHubRelease
```

## 6. 为什么浏览器能上 GitHub，但 `git push` 超时

这是这次实际遇到过的问题，原因已经确认：

- Windows 系统代理已开启
- 浏览器走系统代理，所以能打开 GitHub
- Git 默认不一定跟随系统代理
- 所以浏览器正常，不代表 `git` 和 `gh` 也能直连 GitHub

本机当时的代理情况：

- Windows 用户代理：`127.0.0.1:7897`
- `git` 默认未配置 `http.proxy`
- 所以 `git push` 会报：

```text
Failed to connect to github.com port 443
```

## 7. Git 代理配置

### 7.1 配置代理

```powershell
D:\Git\bin\git.exe config --global http.proxy http://127.0.0.1:7897
D:\Git\bin\git.exe config --global https.proxy http://127.0.0.1:7897
```

### 7.2 检查代理是否已生效

```powershell
D:\Git\bin\git.exe config --global --get http.proxy
D:\Git\bin\git.exe config --global --get https.proxy
```

### 7.3 取消代理

如果以后不再使用该代理：

```powershell
D:\Git\bin\git.exe config --global --unset http.proxy
D:\Git\bin\git.exe config --global --unset https.proxy
```

## 8. GitHub CLI 代理变量

`gh` 不一定自动复用 Git 的代理配置。  
如果当前网络环境下 `gh auth login` 或 `gh release` 访问 GitHub 失败，先在当前终端执行：

```powershell
$env:HTTP_PROXY='http://127.0.0.1:7897'
$env:HTTPS_PROXY='http://127.0.0.1:7897'
```

然后再执行：

```powershell
& 'C:\Program Files\GitHub CLI\gh.exe' auth status
```

或：

```powershell
.\tools\publish_github_release.ps1 -Version 1.0.2 -MarkLatest
```

## 9. 这次实际遇到过的报错与处理

### 9.1 `powershell` 无法识别

现象：

```text
无法将“powershell”项识别为 cmdlet
```

原因：

- 当前已经在 PowerShell 里
- 不需要再套一层 `powershell -File`

处理：

直接执行脚本本体：

```powershell
.\tools\publish_github_release.ps1 -Version 1.0.2 -MarkLatest
```

### 9.2 脚本执行被禁止

现象：

```text
因为在此系统上禁止运行脚本
```

处理：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

然后重试脚本。

### 9.3 `git push` 无法连接 `github.com:443`

处理顺序：

1. 确认本地代理软件正常运行
2. 给 Git 配置代理
3. 重新执行 `git push`

### 9.4 `gh auth status` 显示未登录

处理顺序：

1. 给当前终端补 `HTTP_PROXY` / `HTTPS_PROXY`
2. 执行 `gh auth login`
3. 再执行 `gh auth status`

### 9.5 `release not found`

这是首次创建 Release 时可能出现的正常场景。  
项目里的 [tools/publish_github_release.ps1](../tools/publish_github_release.ps1) 已经修正为：

- 先列出现有 Release
- 若不存在则自动创建
- 若已存在则更新并重新上传附件

## 10. 实际成功路径记录

这次已经验证通过的完整路径如下：

1. 配置 Git 代理
2. 执行 `git push origin main`
3. 设置当前终端的 `HTTP_PROXY` / `HTTPS_PROXY`
4. 确认 `gh auth status`
5. 执行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\tools\publish_github_release.ps1 -Version 1.0.2 -MarkLatest
```

最终成功发布：

- GitHub Release：`v1.0.2`

## 11. 后续维护建议

- 只要系统继续使用本地代理，Git 也应保留代理配置
- 如果以后更换代理端口，需要同步修改 Git 代理配置和当前终端的 `HTTP_PROXY`
- 每次正式发版后，都应检查：
  - `main` 是否已推送
  - tag 是否已推送
  - GitHub Release 是否已创建
  - Release 附件是否完整
