import type { ExtensionSDK } from '@looker/extension-sdk';
import type { ExecutiveSummaryStructured } from '../types';
import { callBackendService } from './backendClient';

export interface FinalSummaryResponse {
  summary: string;
  structured?: ExecutiveSummaryStructured | null;
}

export const generateFinalSummary = async (
  querySummaries: string[],
  restfulService: string,
  extensionSDK: Pick<ExtensionSDK, 'fetchProxy' | 'serverProxy' | 'createSecretKeyTag'>,
  nextStepsInstructions: string,
  description?: string,
  includeNextSteps = true
): Promise<FinalSummaryResponse | null> => {
  if (querySummaries.length === 0) return null;

  try {
    const data = await callBackendService<FinalSummaryResponse>(
      '/generateSummary',
      {
        querySummaries,
        nextStepsInstructions,
        description: description || '',
        includeNextSteps,
      },
      extensionSDK,
      restfulService
    );
    return {
      summary: data.summary || '',
      structured: data.structured ?? null,
    };
  } catch (error) {
    console.error('Error generating executive summary:', error);
    return null;
  }
};
