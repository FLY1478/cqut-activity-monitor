# ADR-0001：云端采集运行环境与免费约束

后续更新：2026-10-13用户改为每180分钟检查，19:00汇总保留；真实手动云端结果见ADR0005，最新时间策略见ADR0002。下文保留当时的判断及预算。
状态：Proposed（待账号资格、云端兼容性和费用实测）；2026-10-12。

## 背景

单人监测，目标五分钟检查、免费优先、微信图文提醒。用户没有常开设备，优先无需绑卡，没有学校邮箱；暂不上传学校或微信凭据。正常 Chrome 本机完整扫描约 225 秒。Windows DPAPI 状态不能直接迁往 Linux。

## 决策

撤回以公开 GitHub Actions／Codespaces 作为长期应用运行环境的建议，保留 CI 和开发测试用途。Cloudflare Workers + D1 作为轻量 API 和管理网页候选；正常浏览器采集放在独立 Linux 主机，优先核实 GitHub 学生权益／Azure 学生方案，尚不指定已可用主机。

学校会话不传给 Worker。完整快照与待发事件原子持久化；单一执行器持租约和执行编号，过期结果不得覆盖新扫描。通知仍使用已验证的官方单人图文预览，达到预算或明确拒绝时模板兜底，未知结果不自动重发。真实报名保持禁用。

本人登录与学校认证分离；无需绑卡方案不依赖要求支付信息的 Cloudflare Zero Trust 开通流程。独立扫描心跳告警需有不依赖 Worker 的备用通道。

## 影响

能够复用现有规则、卡片和正常浏览器采集逻辑，并缩小学校凭据接触范围；同时增加一个采集主机和持久化状态适配，免费资格与地区资源可用性仍是先决条件。图文预览依然是开发测试号能力，不能直接承诺长期可靠。

不能在研究阶段声称免费云端已可用。所有费用、绑卡、资源升级和凭据上传保持当前用户约束。

## 替代方案

Workers 直接采集：仍无已验证的 HTTP 接入，当前程序需要 Chrome；免费 CPU／子请求限额也未达标。

Cloudflare 免费 Browser Run：每天十分钟不足以承担现有负载。Render／Railway：只作为实验候选，未通过长期稳定性与预算验收。Hugging Face 免费计算 Space 旧教程：当前创建 Docker 计算 Space 已要求付费计划。Oracle／Koyeb：当前绑卡要求不符合偏好。

## 参考

第二轮补充（同日）：正常浏览器完整短列表实测 3.759 秒，37 个唯一 ID 与页面数量相符；独立 HTTP 使用有效 Cookie 读取活动列表仍返回 202。增加 alwaysdata / FunctionGraph / Apify / serv00 候选；alwaysdata 优先做 256 MB 无凭据浏览器兼容性验证，FunctionGraph 评估月 400,000 GB·秒预算及默认公网限制。Modal 和 Northflank 的支付方式前置要求不符合当前约束。主机选择继续为 Proposed。

实际开户更新：alwaysdata 注册页当前强制要求验证支付卡，暂停其无需绑卡路线，改为优先 FunctionGraph 的无凭据试点。华为云注册入口尚未完成本人注册；没有在云端运行或上传学校/微信凭据。

两层检查只作预算比较，尚未实现或接受详情降频。列表缺少人数、地点和正文，短列表成功不产生完整扫描心跳，缓存名额需显式过期。完整说明与官方资料见输出文件《云端系统补充研究.md》及《云端替代方案估算.json》。

完整对照、官方链接、负载算式和验收步骤见输出文件《云端系统研究.md》。

- [Actions 与 Codespaces 条款](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features)
- [Browser Run 限额](https://developers.cloudflare.com/browser-run/limits/)
- [GitHub 学生认证](https://docs.github.com/en/education/about-github-education/github-education-for-students/apply-to-github-education-as-a-student)
- [Azure 学生权益](https://learn.microsoft.com/en-us/azure/education-hub/about-azure-for-students)
