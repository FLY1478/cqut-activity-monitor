# 重理工第二课堂活动监测

当前版本是**真实系统接入验证器**，持续监测与微信提醒尚未启用。
先验证自动认证、完整读取和免费云端兼容性，通过后再上线监测。

## 本地验证

需要 Node.js 22.18 或更高版本、Windows 和已安装的 Chrome。

```powershell
npm ci
npm run check
npm test
$env:CQUT_PRIVATE_DIR = '<本机私有目录的绝对路径>'
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File scripts/credentials.ps1 -OutputPath "$env:CQUT_PRIVATE_DIR/credentials.dpapi"
$env:CQUT_CHROMIUM_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run probe -- --normal-browser
```

凭据窗口使用 Windows DPAPI 当前用户加密**整个凭据对象**，不只加密密码。
凭据不得提交 Git；会话、原始响应与页面同样加密保存，不输出到终端。
Windows 加密文件绑定当前 Windows 用户与电脑，不能直接复制到 Linux 使用。

验证器先测试无浏览器 HTTP 入口，再测试正常浏览器的密码登录、独立上下文恢复和无会话重新认证。
需要选择角色时只选择明确标注的学生角色，未知角色不会随便选择。
`local_auth_passed` 只表示本机认证流程通过，**不表示分页、资格判断、云端和微信推送已通过**。
独立上下文恢复不等于进程重启测试；无会话重登也不等于已等待真实会话自然过期。

## 免费云端验证

先运行无需 Secrets 的手动工作流 `Anonymous browser compatibility`。它使用项目实际浏览器启动器，核验 Linux 沙箱、模拟页面、模拟会话重启、提交拦截及学校匿名认证页；不登录账号、不报名、不推送。Linux 沙箱状态无法确认时直接失败，不自动关闭保护。

该方案已在标准 Ubuntu 24.04 runner 实测通过。当前华为云 FunctionGraph 的命名空间限制无法由应用启动参数修复；浏览器运行器与仍待验收的真实登录、持久化和定时运行见 [ADR 0004](docs/adr/0004-managed-browser-runner.md)。

工作流仅支持手动派发，没有定时任务、报名或推送功能。
使用标准 Ubuntu runner、固定提交的 GitHub 官方 Actions 和锁定版本的 npm 依赖。
在仓库 Secrets 配置 `CQUT_USERNAME`、`CQUT_PASSWORD`、`CQUT_STORAGE_KEY` 后运行 `Verify school access`。
后者是 32 字节随机密钥的十六进制形式，用于 runner 临时敏感数据的 AES-256-GCM 加密。
不上传浏览器截图、原始响应、会话或任何私有文件为工作流制品。

## 接入事实和下一阶段

- 目标是学校手机网页 `https://2class.cqut.edu.cn/`。
- 二课列表入口为 `/Student/Activity/index.html`，页面 POST 到 `/Student/Activity/getActivityCanApply.html`。
- 活动详情链接为 `/Student/Activity/apply.html?activityID=…`，仅访问页面不会代替用户报名。
- 页面还包括项目、课程入口，必须检查后才能确定监测范围完整。
- HTTP 入口存在浏览器前置校验；直接 HTTP 和默认自动化启动在本机出现过空页面，不能直接部署为 Worker 采集器。
- 下一阶段仍需活动详情、本人资料、范围完整性、云端认证、过期及重启测试。通过后才实现 D1、差异事件、pushplus 回执、Healthchecks 和私有手机页面。

## 参考资料

认证协议以学校当前手机登录页为依据，登录参考 [CQUT-Helper](https://github.com/lhgr/CQUT-Helper)。
监测设计参考 [NextArc](https://github.com/Amsors/NextArc)。当前代码未复制上述项目实现。

当前没有保证不漏报、五分钟准时执行或永久免人工登录；这些都必须用实际运行数据评估。
