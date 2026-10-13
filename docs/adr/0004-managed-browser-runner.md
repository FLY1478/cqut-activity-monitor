# ADR 0004：保留 Chrome 沙箱，使用原生 GitHub 运行器

日期：2026-10-13。状态：匿名兼容性已实测通过；生产监测未部署。

## 问题与决定

当前华为云 FunctionGraph 镜像函数无法创建 Chrome 所需的命名空间。只读诊断确认辅助程序为 root 所有、4755 权限且 API 自检通过，但用户命名空间上限为 0，PID 和网络命名空间创建被拒绝。重新安装 Chrome 或修改启动路径不能修复这一平台限制。

浏览器采集改用公开仓库的标准 Ubuntu 24.04 GitHub Actions 运行器，直接启动官方 Chrome 和 Xvfb。保留正常 Chrome 沙箱，不添加关闭沙箱、特权容器或扩大系统权限的参数。华为云作为调度候选保留；跨平台派发尚未实现。

共用 `launchNormalBrowser` 采用最长 45 秒的启动等待。在 Linux 上读取浏览器自己的 `chrome://sandbox`，要求 PID 命名空间、网络命名空间和 Seccomp-BPF 全部启用；任何一项缺失或禁用即关闭浏览器并失败。现代 Chrome 的 SUID 层可以显示 No，不以此误判完整隔离失败。Windows 启动路径不增加 Linux 检查。

## 可复现验证

`Anonymous browser compatibility` 仅手动触发，GitHub 权限为 contents:read，不引用学校或微信 Secrets，不配置定时任务。既有 `Verify school access` 工作流保留，凭据上传仍需用户针对目标平台授权。

安装项目锁定依赖后执行类型检查和模拟测试，再用实际共用启动器访问本地模拟页面及学校匿名入口。外部请求只允许指定域名的 HTTPS GET/HEAD；所有提交均拦截。保存并重启的会话只含本地模拟 Cookie，报告不含外部 Cookie、URL 参数或页面正文。

已通过的实际启动器执行：[38331818766](https://github.com/FLY1478/cqut-activity-monitor/actions/runs/38331818766)，测试提交 `91e8d2d`。8 项验收均通过：正常沙箱、模拟操作、重启恢复、提交拦截、学校认证页、微信匿名接口、未用凭据、未读取私人活动。浏览器报告耗时 28.181 秒；首次启动 8.512 秒，重启 0.670 秒。学校入口最初 202，最终到统一认证页并返回 200，不能称为账号登录成功。

远端基线的类型检查通过，7 项测试中 6 项通过、1 项 Windows DPAPI 测试按平台跳过。本机包含现有监测功能的类型检查及 42 项测试全部通过。原生运行器的 cgroup 内存指标不可用，不能用本轮结果承诺完整扫描的内存消耗。

首次匿名测试使用既有工作流文件名在独立分支派发，以满足 workflow_dispatch 的默认分支注册要求。最终变更恢复原认证工作流，并把匿名测试保存为独立文件；合并前不启动生产定时任务。

## 代价与待验收项

公开仓库的标准 GitHub-hosted runner 免费，但排队和原生定时任务可能延迟，不能保证半小时准点。当前每日约 24 次、完整扫描约 225 秒是本机估算；28 秒匿名测试不能替代真实采集预算。最终运行时间、访问限制及额度以真实账号试验衡量。

学校／微信秘密没有上传。本机 DPAPI 文件不能直接搬到 Linux，仍需用户授权的云端密钥及加密持久化方案。真实登录、自然过期续期、全部分页与详情、执行锁、持久化通知队列、微信实际收到、独立告警和连续 72 小时观察均待验收。

保留北京时间 08:00—20:00 每半小时检查、19:00 汇总的重要更新合并规则。本次不改变活动筛选、报名开关或频率，也不创建付费资源。

## 依据

- [Chromium Linux sandbox](https://chromium.googlesource.com/chromium/src/+/main/sandbox/linux)
- [华为云镜像函数说明](https://support.huaweicloud.com/usermanual-functiongraph/functiongraph_01_1047.html)
- [GitHub 标准运行器及公开仓库免费条件](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)
- [Ubuntu 24.04 官方镜像软件](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
