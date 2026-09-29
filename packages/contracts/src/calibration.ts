export type CalibrationDecision = "select" | "reject" | "either";
export type CalibrationFocus = "research" | "engineering";
export interface CalibrationBatchSummary {
  id: string;
  label: string;
  total: number;
  completed: number;
  research: number;
  engineering: number;
  createdAt: string;
}
export interface CalibrationCase {
  caseId: string;
  position: number;
  focus: CalibrationFocus;
  title: string;
  titleZh: string | null;
  guideZh: string | null;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string | null;
  materialScope: string;
  bodyOriginal: string | null;
  bodyZh: string | null;
  decision: CalibrationDecision | null;
  notes: string;
  version: number;
  labelledAt: string | null;
}
export interface CalibrationBatch {
  summary: CalibrationBatchSummary;
  cases: CalibrationCase[];
}
