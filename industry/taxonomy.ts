// RSHOT 行业词表。保留框架的七种内容类型契约。
export const CATEGORIES = [
  { key: "paper", label: "论文方法", section: "论文与方法", guide: "遥感论文、技术报告、反演、定标、成像与 GeoAI 方法；数据集发布优先归 data" },
  { key: "data", label: "数据基准", section: "数据集与基准", guide: "影像与科学数据产品、标注数据集、评测基准、数据开放、版本和许可变更" },
  { key: "rs-tools", label: "模型工具", section: "模型与开源工具", guide: "遥感基础模型、权重、处理库、GIS/EO 工具、云平台、API 与重大更新" },
  { key: "satellite", label: "卫星传感器", section: "卫星与传感器", guide: "对地观测任务、卫星、机载/地基遥感仪器、载荷、定标和观测能力" },
  { key: "tip", label: "应用实践", section: "应用与工程实践", guide: "农业、生态、城市、海洋、灾害等遥感应用，可复用教程、处理流程和工程经验" },
  { key: "industry", label: "行业政策", section: "行业与政策", guide: "遥感政策、标准、数据治理、产业经营和有实际后果的行业事件" },
] as const;
export const ITEM_TYPES = ["model_release", "product_launch", "tool_or_prompt", "research_paper", "industry_event", "opinion_analysis", "tutorial_explainer"] as const;
export const CATEGORY_TAGS = ["论文/研究", "数据集/基准", "模型发布", "工具更新", "开源/仓库", "卫星/传感器", "教程/实践", "应用案例", "观点/分析", "行业动态", "政策/标准", "其他"] as const;
export const TOPIC_TAGS = ["光学遥感", "SAR", "InSAR", "高光谱", "热红外", "LiDAR", "摄影测量", "变化检测", "目标检测", "语义分割", "分类识别", "定量反演", "辐射定标", "数据融合", "时序分析", "遥感基础模型", "多模态", "自监督学习", "泛化/迁移", "数据质量", "数据许可", "云端处理", "部署/工程", "开源生态", "农业", "森林/生态", "城市", "海洋", "气候", "灾害监测"] as const;
export const ENTITY_TAGS = ["NASA", "ESA", "USGS", "Copernicus", "JAXA", "EUMETSAT", "中国科学院空天院", "国家航天局", "中国资源卫星中心", "Google Earth Engine", "TorchGeo", "OSGeo", "ISPRS", "IEEE GRSS", "arXiv"] as const;
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  论文: "论文/研究", 研究: "论文/研究", paper: "论文/研究", papers: "论文/研究",
  数据集: "数据集/基准", 基准: "数据集/基准", "评测/基准": "数据集/基准",
  产品更新: "工具更新", "open-source": "开源/仓库", 开源: "开源/仓库", 仓库: "开源/仓库",
  教程: "教程/实践", "教程/玩法": "教程/实践", "技巧/最佳实践": "教程/实践",
  政策: "政策/标准", "政策/监管": "政策/标准", 标准: "政策/标准",
  观点: "观点/分析", "大佬观点": "观点/分析", "现象/趋势": "观点/分析",
  合成孔径雷达: "SAR", 干涉雷达: "InSAR", 激光雷达: "LiDAR", GEE: "Google Earth Engine",
  "Earth Engine": "Google Earth Engine", AIRCAS: "中国科学院空天院", 基础模型: "遥感基础模型", 跨域泛化: "泛化/迁移",
};
export const CATEGORY_BY_ITEM_TYPE: Readonly<Record<string, string>> = {
  model_release: "模型发布", product_launch: "工具更新", tool_or_prompt: "教程/实践", research_paper: "论文/研究",
  industry_event: "行业动态", opinion_analysis: "观点/分析", tutorial_explainer: "教程/实践",
};
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[] }> = {
  nasa: { name: "NASA", displayTag: "NASA", aliases: ["NASA", "美国航空航天局", "Earthdata"] },
  esa: { name: "ESA", displayTag: "ESA", aliases: ["ESA", "European Space Agency", "欧洲空间局"] },
  usgs: { name: "USGS", displayTag: "USGS", aliases: ["USGS", "美国地质调查局"] },
  copernicus: { name: "Copernicus", displayTag: "Copernicus", aliases: ["Copernicus", "哥白尼", "CDSE"] },
  jaxa: { name: "JAXA", displayTag: "JAXA", aliases: ["JAXA"] },
  eumetsat: { name: "EUMETSAT", displayTag: "EUMETSAT", aliases: ["EUMETSAT"] },
  aircas: { name: "中国科学院空天院", displayTag: "中国科学院空天院", aliases: ["中国科学院空天信息创新研究院", "空天院", "AIRCAS"] },
  cnsa: { name: "国家航天局", displayTag: "国家航天局", aliases: ["国家航天局", "CNSA"] },
  cresda: { name: "中国资源卫星中心", displayTag: "中国资源卫星中心", aliases: ["中国资源卫星应用中心", "CRESDA"] },
  google: { name: "Google Earth Engine", displayTag: "Google Earth Engine", aliases: ["Google Earth Engine", "Earth Engine", "GEE", "Google Earth"] },
  torchgeo: { name: "TorchGeo", displayTag: "TorchGeo", aliases: ["TorchGeo", "TerraTorch"] },
  osgeo: { name: "OSGeo", displayTag: "OSGeo", aliases: ["OSGeo", "GDAL", "QGIS"] },
  isprs: { name: "ISPRS", displayTag: "ISPRS", aliases: ["ISPRS", "国际摄影测量与遥感学会"] },
  grss: { name: "IEEE GRSS", displayTag: "IEEE GRSS", aliases: ["IEEE GRSS"] },
};
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "nasa", name: "NASA", patterns: [/\bNASA\b|美国航空航天局/i] },
  { id: "esa", name: "ESA", patterns: [/\bESA\b|European Space Agency|欧洲空间局/i] },
  { id: "usgs", name: "USGS", patterns: [/\bUSGS\b|美国地质调查局/i] },
  { id: "copernicus", name: "Copernicus", patterns: [/\bCopernicus\b|\bCDSE\b|哥白尼/i] },
  { id: "jaxa", name: "JAXA", patterns: [/\bJAXA\b/i] },
  { id: "aircas", name: "中国科学院空天院", patterns: [/空天院|空天信息创新研究院|\bAIRCAS\b/i] },
  { id: "google", name: "Google Earth Engine", patterns: [/Google|Earth Engine|\bGEE\b|谷歌/i] },
  { id: "osgeo", name: "OSGeo", patterns: [/\bOSGeo\b/i] },
];
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "nasa", domains: ["nasa.gov"] }, { entityId: "esa", domains: ["esa.int"] },
  { entityId: "usgs", domains: ["usgs.gov"] }, { entityId: "copernicus", domains: ["copernicus.eu"] },
  { entityId: "jaxa", domains: ["jaxa.jp"] }, { entityId: "eumetsat", domains: ["eumetsat.int"] },
  { entityId: "aircas", domains: ["aircas.ac.cn", "aircas.cas.cn"] },
  { entityId: "cnsa", domains: ["cnsa.gov.cn"] }, { entityId: "cresda", domains: ["cresda.com"] },
  { entityId: "google", domains: ["earthengine.google.com", "developers.google.com"] },
  { entityId: "osgeo", domains: ["osgeo.org", "gdal.org", "qgis.org"] },
  { entityId: "isprs", domains: ["isprs.org"] },
];
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
