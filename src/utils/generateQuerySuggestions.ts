import type { ExtensionSDK } from '@looker/extension-sdk';
import type { QuerySuggestionItem } from '../types';
import { callBackendService } from './backendClient';

interface QuerySuggestionsResponse {
  suggestions: QuerySuggestionItem[] | string;
}

export function normalizeQuerySuggestions(raw: unknown): QuerySuggestionItem[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item): QuerySuggestionItem | null => {
        if (typeof item === 'string') {
          return { querySuggestion: item };
        }
        if (item && typeof item === 'object' && 'querySuggestion' in item) {
          const typed = item as Record<string, unknown>;
          return {
            querySuggestion: String(typed.querySuggestion || '').trim(),
            rationale: typed.rationale ? String(typed.rationale) : undefined,
            category: typed.category ? String(typed.category) : undefined,
          };
        }
        return null;
      })
      .filter((item): item is QuerySuggestionItem => Boolean(item?.querySuggestion));
  }

  if (typeof raw === 'string' && raw.trim()) {
    const cleaned = raw
      .replace(/'''json|'''/g, '')
      .replace(/```json|```/g, '')
      .trim();
    try {
      return normalizeQuerySuggestions(JSON.parse(cleaned));
    } catch {
      return [];
    }
  }

  return [];
}

export const generateQuerySuggestions = async (
  querySummaries: string[],
  restfulService: string,
  extensionSDK: Pick<ExtensionSDK, 'fetchProxy' | 'serverProxy' | 'createSecretKeyTag'>,
  nextStepsInstructions: string
): Promise<QuerySuggestionItem[]> => {
  if (querySummaries.length === 0) return [];

  try {
    const data = await callBackendService<QuerySuggestionsResponse>(
      '/generateQuerySuggestions',
      {
        querySummaries,
        nextStepsInstructions,
      },
      extensionSDK,
      restfulService
    );
    return normalizeQuerySuggestions(data?.suggestions);
  } catch (error) {
    console.error('Error generating query suggestions:', error);
    return [];
  }
};
