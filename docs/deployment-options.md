# RSHOT 部署平台选择

核对日期：2026-09-29。下面为官方页面当前显示的美元价格，实际以选定地域、库存、税费和结算页面为准；均不含模型 API、域名及独立备份费用。

## 推荐

按当前“先免费测试”的需求，先用 **GitHub Pages 的只读预览**。免费地址为 `https://mochiuaena.github.io/RSHOT/`，精选、摘要、搜索、分类与简报读取来自公开内容导出。采集、模型处理和数据库继续在本机运行；网页标明实际导出时间，不宣称云端自动更新。使用方式见 [免费 Pages 预览](pages-preview.md)。

完整后台免费部署，可考虑 Oracle Cloud Always Free 的 Arm 实例：官方页面当前显示每月 1,500 OCPU 小时与 9,000 GB 内存小时，约等于持续运行的 2 OCPU / 12 GB 配额。可以在虚拟机上运行 Compose 和 PostgreSQL，但需要银行卡验证，是否能分配实例取决于地域容量；当前项目尚未在 Arm 服务器完成实测。不要把 30 天 300 美元试用额度当成长期免费额度。

## 免费方案的范围

| 方案 | 能做什么 | 当前限制 |
|---|---|---|
| GitHub Pages | 免费地址和 HTTPS，浏览公开快照、搜索分类、阅读已发布简报 | 不运行 Node 后端、数据库或 worker；更新需要本机重新导出并推送 |
| Oracle Cloud Always Free | 免费额度内的虚拟机可以托管完整后台和数据库 | 用户注册与银行卡验证；地域容量不保证；需确认实际免费标记并测试 Arm 构建 |
| Render 免费服务 | 免费网址，可短期验证 Node 网页与 API | 闲置 15 分钟休眠；每月 750 免费实例小时由工作区共享；免费 PostgreSQL 1 GB、30 天到期，之后 14 天宽限结束会删除；后台 worker 无免费档 |

不使用定时访问等方法绕过平台休眠规则。现有 Render 免费额度不适合 RSHOT 的持续更新和长期数据库；换成外部免费数据库仍然没有解决常驻 worker。

## 后续付费常驻方案

需要稳定常驻且免费实例无法申请时，再考虑 Linux 云服务器 + Docker Compose，优先 2 vCPU / 4 GB RAM / 至少 50 GB 磁盘。项目已经包含 PostgreSQL、长期运行的 worker、网页与 Caddy，不需要拆成多个平台服务。

可先看阿里云轻量应用服务器国际站的 2 核 / 4 GB 套餐。面向中文用户，同时需要读取国际科研信源，可比较亚洲地域；页面价格不代表已经验证香港或新加坡的具体库存与报价，购买前在结算页确认。

## 费用与适配

| 平台 | 官方页面显示的资源与价格 | 对 RSHOT 的适配 |
|---|---|---|
| 阿里云轻量应用服务器（国际站） | 2 vCPU / 4 GiB / 50 GB：**16 美元/月**；2 vCPU / 2 GiB / 40 GB：8 美元/月 | 推荐 4 GB 档，直接运行 Compose；需要管理 Linux、更新和备份 |
| DigitalOcean Basic Regular Droplet | 2 vCPU / 4 GiB / 80 GiB / 4 TB 流量：**24 美元/月**；1 vCPU / 2 GiB：12 美元/月 | 同样可直接部署 Compose，资源和计费清楚；独立备份额外收费 |
| Railway Hobby | **最低用量消费 5 美元/月**，含 5 美元额度；内存约 10 美元/GB/30 天，CPU 持续满用约 20 美元/vCPU/30 天，出站 0.05 美元/GB | 适合愿意按使用量付费的托管方案；需拆分 web/api/worker/PostgreSQL，配置持久卷与迁移任务 |

Railway 的 5 美元不是整个 RSHOT 的固定月费。内存和 CPU 按实际使用时间累计，数据库也计入资源；卷约 0.156 美元/GB/30 天。免费档的内存和存储限制不适合稳定运行当前完整栈。

1 GB 或更小的低价实例不建议用于当前项目的服务器构建；4 GB 档给 Node、镜像构建和数据库留出空间。后续若改为 CI 预构建镜像，可以再按实际监测结果缩减配置。

## 选择后需要的信息

1. 平台与地域、实例规格，以及希望控制的月预算。
2. 是否已有域名；若没有，可先用 IP 做私有预览。
3. 服务器创建后提供可用的操作入口；密码、SSH 私钥和 API 密钥由用户在本地安全配置。
4. 上线前确认运营主体、联系邮箱与条款模板。

选平台后按 [部署流程](deploy.md) 配置。当前本机自动更新仅在电脑、Docker 与后台进程运行期间有效；公网常驻运行依靠云服务器。

## 官方参考

- [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/)；官方页面当前显示 Arm 额度及银行卡验证说明，实际按账号、地域与控制台为准。
- [Render 免费实例](https://render.com/docs/free)；已核对休眠、共享实例时数、数据库到期与支持的免费服务类型。
- [GitHub Pages 介绍](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)。
- [阿里云轻量应用服务器](https://www.alibabacloud.com/zh/product/swas)
- [DigitalOcean Droplet 价格](https://www.digitalocean.com/pricing/droplets)；页面备份选项显示周备份另加实例价格的 20%，日备份另加 30%。
- [Railway 价格](https://railway.com/pricing)；内存 0.00000386 美元/GB/秒、CPU 0.00000772 美元/vCPU/秒、卷 0.00000006 美元/GB/秒。
