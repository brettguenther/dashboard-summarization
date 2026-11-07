import React, { useState } from 'react';
import { DashboardSummarization } from './components/DashboardSummarization';
import { StandaloneWorkspace } from './components/StandaloneWorkspace';
import {
  LookerExtensionProvider,
  useExtensionHost,
  type ExtensionHostContextValue,
} from './contexts/ExtensionHostContext';
import { SummaryDataContext } from './contexts/SummaryDataContext';
import type {
  ExecutiveSummaryStructured,
  QuerySuggestionItem,
  SummaryDataContextType,
  TileSummaryCard,
  ToastNotice,
} from './types';
import './index.css';

const ExtensionMountRouter: React.FC = () => {
  const { isStandaloneMount } = useExtensionHost();
  return isStandaloneMount ? <StandaloneWorkspace /> : <DashboardSummarization />;
};

export const App: React.FC<{ hostOverride?: ExtensionHostContextValue }> = ({
  hostOverride,
}) => {
  const [tileSummaries, setTileSummaries] = useState<TileSummaryCard[]>([]);
  const [executiveMarkdown, setExecutiveMarkdown] = useState<string>('');
  const [executiveStructured, setExecutiveStructured] =
    useState<ExecutiveSummaryStructured | null>(null);
  const [querySuggestions, setQuerySuggestions] = useState<QuerySuggestionItem[]>([]);
  const [toast, setToast] = useState<ToastNotice | null>(null);
  const [dashboardURL, setDashboardURL] = useState<string>('');

  const contextValue: SummaryDataContextType = {
    tileSummaries,
    setTileSummaries,
    executiveMarkdown,
    setExecutiveMarkdown,
    executiveStructured,
    setExecutiveStructured,
    querySuggestions,
    setQuerySuggestions,
    toast,
    setToast,
    dashboardURL,
    setDashboardURL,
  };

  return (
    <LookerExtensionProvider overrideValue={hostOverride}>
      <SummaryDataContext.Provider value={contextValue}>
        <ExtensionMountRouter />
      </SummaryDataContext.Provider>
    </LookerExtensionProvider>
  );
};
