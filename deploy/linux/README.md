# 正常沙箱 Linux 主机部署包（尚未安装）

只适用于允许 Chrome 正常沙箱的持久化 Linux 主机。不是 FunctionGraph 镜像函数的兼容性补丁。当前没有已验证满足完全免费、无需绑卡条件的生产主机，不要据此声称上线。

- 通用源码放 `/opt/cqut-activity-monitor`；Node≥22.18、官方 Chrome、Xvfb 已安装。
- 使用专用非管理员用户 `cqut-monitor`。私有目录 `/var/lib/cqut-monitor` 权限0700；运行配置 `/etc/cqut-monitor/runtime.env` 权限0600，仅含 `CQUT_STORAGE_KEY`、`CQUT_CHROMIUM_PATH`。钥匙不得写进提交或日志。
- 学校凭据、会话、通知配置、基线、待发队列均使用现有 AES-GCM 加密文件。Windows DPAPI 文件不能直接移植；需在获准的生产平台重新配置，不从公开制品恢复。
- 两个 systemd 文件提供08/11/14/17/19时段，19:30只做条件允许的汇总补试；重启补执行仍由北京时间窗口和持久化去重控制。20:00后不扫描、不主动发活动消息。
- `TimeoutStartSec=20min`、`KillMode=control-group` 在超时时清理整组进程。所有原始材料保留在私有加密存储，不公开上传。
- 设置加密 `health-config.dpapi` 后向独立 Worker 上报有限健康元数据，不传活动、姓名、学校账号密码、Cookie或票据。无配置时仅本机记录，不能误称已接外部告警。

安装前先完成正常沙箱、全量采集、跨重启持久化、定时去重、漏执行与恢复实收测试，随后连续观察72小时。免费资格、主机权限和稳定性未经核实前，不启用定时或上传长期凭据。
