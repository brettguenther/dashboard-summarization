import type React from 'react';
import type { Filters } from '@looker/extension-sdk';

export interface DashboardQuery {
  fields: string[] | string;
  dynamic_fields?: unknown;
  view: string;
  model: string;
  filters?: Record<string, string>;
  pivots?: string[] | null;
  sorts?: string[] | null;
  limit?: string | null;
  column_limit?: string | null;
  row_total?: string | null;
  subtotals?: string[] | null;
}

export interface Query {
  queryBody: DashboardQuery;
  note_text: string;
  title: string;
}

export interface QueryWithData extends Query {
  queryData: Array<Record<string, unknown>>;
}

export interface FilterListener {
  field: string;
  dashboard_filter_name: string;
}

export interface Filterable {
  listen: FilterListener[];
}

export interface ResultMaker {
  query?: DashboardQuery | null;
  filterables?: Filterable[];
}

export interface DashboardElement {
  query: DashboardQuery | null;
  result_maker: ResultMaker | null;
  note_text: string | null;
  title: string | null;
}

export interface DashboardMetadata {
  dashboardFilters: Filters | undefined;
  dashboardId: string | undefined;
  queries: Query[];
  description?: string;
}

export interface ExecutiveHighlight {
  headline: string;
  detail: string;
  impact: 'positive' | 'negative' | 'neutral';
}

export interface ExecutiveRecommendation {
  action: string;
  rationale: string;
  priority: 'high' | 'medium';
}

export interface ExecutiveSummaryStructured {
  executiveOverview: string;
  keyHighlights: ExecutiveHighlight[];
  recommendations: ExecutiveRecommendation[];
}

export interface TileSummaryCard {
  index: number;
  title: string;
  noteText?: string;
  markdown: string;
}

export interface QuerySuggestionItem {
  querySuggestion: string;
  rationale?: string;
  category?: string;
}

export interface ToastNotice {
  type: 'success' | 'error' | 'info';
  text: string;
}

export interface SummaryDataContextType {
  tileSummaries: TileSummaryCard[];
  setTileSummaries: React.Dispatch<React.SetStateAction<TileSummaryCard[]>>;
  executiveMarkdown: string;
  setExecutiveMarkdown: React.Dispatch<React.SetStateAction<string>>;
  executiveStructured: ExecutiveSummaryStructured | null;
  setExecutiveStructured: React.Dispatch<React.SetStateAction<ExecutiveSummaryStructured | null>>;
  querySuggestions: QuerySuggestionItem[];
  setQuerySuggestions: React.Dispatch<React.SetStateAction<QuerySuggestionItem[]>>;
  toast: ToastNotice | null;
  setToast: React.Dispatch<React.SetStateAction<ToastNotice | null>>;
  dashboardURL: string;
  setDashboardURL: React.Dispatch<React.SetStateAction<string>>;
}

export interface LoadingStates {
  [key: string]: boolean;
}

export type PipelineMode = 'single_pass' | 'parallel';

export interface TileConfiguration {
  autoRun: boolean;
  autoRefreshOnFilterChange: boolean;
  allowPromptOverride: boolean;
  pipelineMode: PipelineMode;
  defaultPresetId: string | null;
  defaultPrompt: string;
  showNextSteps: boolean;
  showFollowUpQuestions: boolean;
}

export interface SummarizationPipelineOptions {
  showNextSteps: boolean;
  showFollowUpQuestions: boolean;
  pipelineMode?: PipelineMode;
}
