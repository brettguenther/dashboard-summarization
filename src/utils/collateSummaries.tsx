import type React from 'react';
import type { ExtensionSDK } from '@looker/extension-sdk';
import type {
  DashboardMetadata,
  ExecutiveSummaryStructured,
  LoadingStates,
  QuerySuggestionItem,
  QueryWithData,
  SummarizationPipelineOptions,
  TileSummaryCard,
} from '../types';
import { fetchQuerySummary } from './fetchQuerySummary';
import { generateExecutivePackage } from './generateExecutivePackage';
import { generateFinalSummary } from './generateFinalSummary';
import { generateQuerySuggestions } from './generateQuerySuggestions';

export interface CollatePipelineCallbacks {
  setTileSummaries: React.Dispatch<React.SetStateAction<TileSummaryCard[]>>;
  setExecutiveMarkdown: React.Dispatch<React.SetStateAction<string>>;
  setExecutiveStructured: React.Dispatch<React.SetStateAction<ExecutiveSummaryStructured | null>>;
  setQuerySuggestions: React.Dispatch<React.SetStateAction<QuerySuggestionItem[]>>;
  setLoadingStates: React.Dispatch<React.SetStateAction<LoadingStates>>;
  setSynthesizingExecutive: React.Dispatch<React.SetStateAction<boolean>>;
}

export const collateSummaries = async (
  queryResults: QueryWithData[],
  nextStepsInstructions: string,
  restfulService: string,
  extensionSDK: Pick<
    ExtensionSDK,
    'fetchProxy' | 'serverProxy' | 'createSecretKeyTag' | 'rendered'
  >,
  dashboardMetadata: DashboardMetadata,
  callbacks: CollatePipelineCallbacks,
  options: SummarizationPipelineOptions = {
    showNextSteps: true,
    showFollowUpQuestions: true,
    pipelineMode: 'single_pass',
  }
): Promise<TileSummaryCard[]> => {
  if (!queryResults || queryResults.length === 0) {
    return [];
  }

  const initialLoadingStates: LoadingStates = {};
  queryResults.forEach((_, index) => {
    initialLoadingStates[`query-${index}`] = true;
  });
  callbacks.setLoadingStates(initialLoadingStates);
  callbacks.setSynthesizingExecutive(true);

  // Fast Single-Pass Mode (Default): Sends all tile data in 1 unified request (~3s total)
  if (options.pipelineMode !== 'parallel') {
    try {
      const packageResult = await generateExecutivePackage(
        queryResults,
        nextStepsInstructions,
        restfulService,
        extensionSDK,
        dashboardMetadata,
        {
          includeNextSteps: options.showNextSteps,
          includeSuggestions: options.showFollowUpQuestions,
          thinkingBudget: 0,
        }
      );

      const clearedLoadingStates: LoadingStates = {};
      queryResults.forEach((_, index) => {
        clearedLoadingStates[`query-${index}`] = false;
      });
      callbacks.setLoadingStates(clearedLoadingStates);
      callbacks.setSynthesizingExecutive(false);

      if (packageResult) {
        callbacks.setTileSummaries(packageResult.tileSummaries);
        callbacks.setExecutiveMarkdown(packageResult.summary);
        callbacks.setExecutiveStructured(packageResult.structured);
        callbacks.setQuerySuggestions(
          options.showFollowUpQuestions ? packageResult.suggestions : []
        );
        extensionSDK.rendered?.();
        return packageResult.tileSummaries;
      }
      return [];
    } catch (err) {
      console.error('Failed in single-pass executive summarization:', err);
      const clearedLoadingStates: LoadingStates = {};
      queryResults.forEach((_, index) => {
        clearedLoadingStates[`query-${index}`] = false;
      });
      callbacks.setLoadingStates(clearedLoadingStates);
      callbacks.setSynthesizingExecutive(false);
      return [];
    }
  }

  // Parallel Mode: Multi-call fan-out summarizing each tile independently before executive collation
  const slots: Array<TileSummaryCard | null> = new Array(queryResults.length).fill(null);

  const settled = await Promise.allSettled(
    queryResults.map(async (queryResult, index) => {
      try {
        const card = await fetchQuerySummary(
          queryResult,
          index,
          restfulService,
          extensionSDK,
          dashboardMetadata,
          nextStepsInstructions
        );
        if (card) {
          slots[index] = card;
          callbacks.setTileSummaries(slots.filter((c): c is TileSummaryCard => c !== null));
        }
        return card;
      } finally {
        callbacks.setLoadingStates((prev) => ({
          ...prev,
          [`query-${index}`]: false,
        }));
      }
    })
  );

  const completedCards = settled
    .map((res) => (res.status === 'fulfilled' ? res.value : null))
    .filter((card): card is TileSummaryCard => card !== null);

  if (completedCards.length > 0) {
    const markdownList = completedCards.map((c) => c.markdown);
    const [execResult, suggestions] = await Promise.all([
      generateFinalSummary(
        markdownList,
        restfulService,
        extensionSDK,
        nextStepsInstructions,
        dashboardMetadata.description,
        options.showNextSteps
      ),
      options.showFollowUpQuestions
        ? generateQuerySuggestions(
            markdownList,
            restfulService,
            extensionSDK,
            nextStepsInstructions
          )
        : Promise.resolve([]),
    ]);

    if (execResult) {
      callbacks.setExecutiveMarkdown(execResult.summary);
      const normalizedStructured = execResult.structured
        ? {
            ...execResult.structured,
            recommendations: options.showNextSteps
              ? execResult.structured.recommendations
              : [],
          }
        : null;
      callbacks.setExecutiveStructured(normalizedStructured);
    }
    callbacks.setQuerySuggestions(options.showFollowUpQuestions ? suggestions : []);
  }

  callbacks.setSynthesizingExecutive(false);
  extensionSDK.rendered?.();
  return completedCards;
};
