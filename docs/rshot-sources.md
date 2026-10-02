# RSHOT 信源报告

首版按科研与工程并重配置，2026 年 10 月 2 日扩充后：**20 个已启用来源（原有 14 个加 4 个 X、2 个公众号）**，另保留未通过当前读取核验的候选。验证检查标题、原文地址、发布日期和完整材料，不只检查 HTTP 200。

新增来源：USGS Landsat、Copernicus EMS、Copernicus EU、geemap 作者 giswqs，以及公众号遥感学报、GIS前沿。免费采集在本机运行，均登记为受限 `external/editorial`；[已确认名单与实机核验状态](social-source-plan.md)、[免费本机读取与运行说明](social-source-ops.md)。X 登录和公众号授权不随 GitHub 或 Pages 发布。

## 已接入来源

| 来源 | 内容 | 接口 | 条目数 / 有日期 | 验证时间（UTC） |
|---|---|---|---:|---|
| [arXiv · 遥感与地球观测预印本](https://export.arxiv.org/api/query?search_query=all:%22remote%20sensing%22%20OR%20all:%22earth%20observation%22%20OR%20all:%22satellite%20imagery%22&sortBy=submittedDate&sortOrder=descending&max_results=60) | 遥感与 EO 预印本检索，摘要作输入，最多60条 | rss | 60 / 60 | 2026-09-29T06:40:20.353Z |
| [ESA · 对地观测](https://www.esa.int/rssfeed/Our_Activities/Observing_the_Earth) | 对地观测任务与传感器 | rss | 15 / 15 | 2026-09-29T06:40:10.034Z |
| [Copernicus Data Space · 数据与平台动态](https://dataspace.copernicus.eu/rss.xml) | Sentinel 数据开放、平台功能与应用；过滤例行机动/维护 | rss | 50 / 30 | 2026-09-29T06:40:10.041Z |
| [Google Earth 与 Earth Engine · 官方博客](https://medium.com/feed/google-earth) | Earth 与 Earth Engine 官方平台/实践 | rss | 10 / 10 | 2026-09-29T06:40:12.934Z |
| [中国科学院空天院 · 科研动态](https://aircas.cas.cn/dtxw/kydt/) | 国内一手科研动态与数据成果 | web_list | 15 / 15 | 2026-09-29T06:40:21.619Z |
| [Earth System Science Data · 数据论文与讨论稿](https://essd.copernicus.org/) | 数据论文与讨论稿；由模型筛遥感相关内容 | web_list | 100 / 100 | 2026-09-29T06:40:29.524Z |
| [TerraTorch · 稳定版本发布](https://github.com/torchgeo/terratorch/releases.atom) | 遥感工程相关开源项目版本与变更说明 | rss | 10 / 10 | 2026-09-29T06:40:31.614Z |
| [GDAL · 稳定版本发布](https://github.com/OSGeo/gdal/releases.atom) | 遥感工程相关开源项目版本与变更说明 | rss | 10 / 6 | 2026-09-29T06:40:57.298Z |
| [Rasterio · 稳定版本发布](https://github.com/rasterio/rasterio/releases.atom) | 遥感工程相关开源项目版本与变更说明 | rss | 10 / 6 | 2026-09-29T06:47:58.905Z |
| [geemap · 稳定版本发布](https://github.com/gee-community/geemap/releases.atom) | 遥感工程相关开源项目版本与变更说明 | rss | 10 / 6 | 2026-09-29T06:41:06.092Z |
| [Earth Engine API · 稳定版本发布](https://github.com/google/earthengine-api/releases.atom) | 遥感工程相关开源项目版本与变更说明 | rss | 10 / 4 | 2026-09-29T06:40:56.560Z |
| [PySTAC · 稳定版本发布](https://github.com/stac-utils/pystac/releases.atom) | 遥感工程相关开源项目版本与变更说明 | rss | 10 / 10 | 2026-09-29T06:41:29.802Z |
| [openEO Python Client · 稳定版本发布](https://github.com/Open-EO/openeo-python-client/releases.atom) | 遥感工程相关开源项目版本与变更说明 | rss | 10 / 10 | 2026-09-29T06:41:26.966Z |
| [NASA Earthdata · 科学数据与工具](https://www.earthdata.nasa.gov/rss.xml) | NASA 科学数据、工具与应用 | rss | 10 / 10 | 2026-09-29T06:41:21.831Z |

读取结果的机器记录：[source-verification.json](source-verification.json)。网络代理、地域、服务端策略会影响部署机器的结果；迁移到服务器后应重新执行检查。

## 选择与运行规则

- 机构官网和原创研究作为一手来源；arXiv 与 ESSD 讨论稿不视为已通过同行评审。
- 保留原始发布日期；每个源首次回灌最多4条；全文展示与全文再分发均关闭。
- GitHub 默认使用 Releases Atom，避免匿名 API 配额影响；筛掉标题含 rc0、rc1、-rc、alpha、beta 的预发布条目，模型仍需判断版本是否有实质价值。
- arXiv 查询使用三组明确遥感短语，而不拉取整个计算机视觉分类；默认180分钟轮询，仍可能漏掉没使用这些措辞的论文。
- ESSD 范围比遥感宽，正文提取后经过遥感相关性预筛；列表日期按UTC解释。
- 热点继续要求48小时内至少两个独立主体，专业精选与日报可收录单一一手来源的成果。

## 暂停或未接入的候选

- TorchGeo：官方 GitHub Releases API曾读取成功；Releases Atom在本机重复超时，默认暂停，需部署网络复核或配置只读 GitHub token后再切换API。TerraTorch订阅已启用。
- MDPI Remote Sensing：本次RSS返回403，未作为已启用来源。
- NASA Earth Observatory旧入口重定向到非Feed内容，未启用；已接入Earthdata。
- NASA ORNL DAAC入口返回的内容未能被Feed解析器读取，PO.DAAC连接失败，未启用。
- TGRS、RSE、ISPRS期刊与USGS更新适合后续扩充，尚未验证并配置稳定采集入口。
- 免费 X／公众号来源已接入；其余候选按真实身份和近期材料继续核验。现有付费 `x_search`／`mp_account` 入口仍可选，但本次没有启用收费采集服务。

## 重新检查

```powershell
node --env-file=.env scripts/check-sources.ts
node --env-file=.env scripts/check-sources.ts --source arxiv-rs
```

检查只读取来源，不写数据库，不调用模型。结果保存在 `.data/source-checks/`。信源新增与试抓也可通过 `/admin` 完成。
