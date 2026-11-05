import type { ExtensionSDK } from '@looker/extension-sdk';
import type { DashboardMetadata, QueryWithData, TileSummaryCard } from '../types';
import { callBackendService } from './backendClient';

interface QuerySummaryResponse {
  summary: string;
  title?: string;
}

export const fetchQuerySummary = async (
  queryResult: QueryWithData,
  index: number,
  restfulService: string,
  extensionSDK: Pick<ExtensionSDK, 'fetchProxy' | 'serverProxy' | 'createSecretKeyTag'>,
  dashboardMetadata: DashboardMetadata,
  nextStepsInstructions: string
): Promise<TileSummaryCard | null> => {
  try {
    const data = await callBackendService<QuerySummaryResponse>(
      '/generateQuerySummary',
      {
        query: queryResult,
        description: dashboardMetadata.description || '',
        nextStepsInstructions,
      },
      extensionSDK,
      restfulService
    );

    if (!data?.summary) {
      return null;
    }

    return {
      index,
      title: queryResult.title || data.title || `Tile ${index + 1}`,
      noteText: queryResult.note_text || undefined,
      markdown: data.summary,
    };
  } catch (error) {
    console.error(`Error generating summary for tile "${queryResult.title}":`, error);
    return null;
  }
};
