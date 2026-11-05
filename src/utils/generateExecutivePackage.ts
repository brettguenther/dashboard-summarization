import type { ExtensionSDK } from '@looker/extension-sdk';
import type {
  DashboardMetadata,
  ExecutiveSummaryStructured,
  QuerySuggestionItem,
  QueryWithData,
  TileSummaryCard,
} from '../types';
import { callBackendService } from './backendClient';

export interface RawTileSummary {
  title: string;
  markdown: string;
  headlineTakeaway?: string;
  bulletPoints?: string[];
}

export interface ExecutivePackageResponse {
  summary: string;
  structured?: ExecutiveSummaryStructured | null;
  tileSummaries?: RawTileSummary[];
  suggestions?: QuerySuggestionItem[];
}

export interface ExecutivePackageResult {
  summary: string;
  structured: ExecutiveSummaryStructured | null;
  tileSummaries: TileSummaryCard[];
  suggestions: QuerySuggestionItem[];
}

export const generateExecutivePackage = async (
  queryResults: QueryWithData[],
  prompt: string,
  restfulService: string,
  extensionSDK: Pick<ExtensionSDK, 'fetchProxy' | 'serverProxy' | 'createSecretKeyTag'>,
  dashboardMetadata: DashboardMetadata,
  options: {
    includeNextSteps?: boolean;
    includeSuggestions?: boolean;
    thinkingBudget?: number;
  } = {}
): Promise<ExecutivePackageResult | null> => {
  if (!queryResults || queryResults.length === 0) return null;

  const tiles = queryResults.map((qr, idx) => ({
    title: qr.title || `Tile ${idx + 1}`,
    note_text: qr.note_text || '',
    data: Array.isArray(qr.queryData) ? qr.queryData.slice(0, 25) : [],
  }));

  try {
    const data = await callBackendService<ExecutivePackageResponse>(
      '/generateExecutivePackage',
      {
        dashboardTitle: dashboardMetadata.dashboardId || 'Dashboard',
        dashboardDescription: dashboardMetadata.description || '',
        prompt,
        tiles,
        includeNextSteps: options.includeNextSteps ?? true,
        includeSuggestions: options.includeSuggestions ?? true,
        thinkingBudget: options.thinkingBudget,
      },
      extensionSDK,
      restfulService
    );

    if (!data) return null;

    const cards: TileSummaryCard[] = (data.tileSummaries || []).map((ts, idx) => ({
      index: idx,
      title: queryResults[idx]?.title || ts.title || `Tile ${idx + 1}`,
      noteText: queryResults[idx]?.note_text || undefined,
      markdown: ts.markdown || '',
    }));

    return {
      summary: data.summary || '',
      structured: data.structured ?? null,
      tileSummaries: cards,
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    };
  } catch (error) {
    console.error('Error generating single-pass executive package:', error);
    return null;
  }
};
