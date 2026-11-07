import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Filter,
  Info,
  LayoutGrid,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import type { Filters } from '@looker/extension-sdk';
import { appConfig } from '../config';
import { useExtensionHost } from '../contexts/ExtensionHostContext';
import { SummaryDataContext } from '../contexts/SummaryDataContext';
import useSlackOauth from '../hooks/useSlackOauth';
import useWorkspaceOauth from '../hooks/useWorkspaceOauth';
import type {
  DashboardMetadata,
  LoadingStates,
  QueryWithData,
  SummaryDataContextType,
  TileConfiguration,
} from '../types';
import { collateSummaries } from '../utils/collateSummaries';
import { fetchDashboardDetails, serializeDashboardFilters } from '../utils/fetchDashboardDetails';
import { clearQueryDataCache, fetchQueryData } from '../utils/fetchQueryData';
import { PRESET_PROMPTS, type PresetPrompt } from '../utils/presets';
import {
  DEFAULT_TILE_CONFIG,
  loadTileConfig,
  MAX_PROMPT_LENGTH,
  saveTileConfig,
} from '../utils/tileConfigStorage';
import {
  GeminiSparkleIcon,
  GoogleChatBrandIcon,
  LookerRingsIcon,
  SlackBrandIcon,
} from './BrandIcons';
import MarkdownComponent from './MarkdownComponent';
import { QuerySuggestions } from './QuerySuggestions';
import { TileConfigPanel } from './TileConfigPanel';

type ActiveTab = 'executive' | 'tiles';
type EditSubView = 'config' | 'preview';

function stripRedundantTileHeading(markdown: string, tileTitle: string): string {
  const trimmed = markdown.trimStart();
  const match = trimmed.match(/^#{1,3}\s+([^\n]+)\n+/);
  if (!match) return markdown;
  const headingText = match[1].replace(/[*_`]/g, '').trim().toLowerCase();
  const normalizedTitle = tileTitle.trim().toLowerCase();
  if (headingText === normalizedTitle || headingText.includes(normalizedTitle)) {
    return trimmed.slice(match[0].length).trimStart();
  }
  return markdown;
}

export interface DashboardSummarizationProps {
  tileConfigOverride?: TileConfiguration;
}

export const DashboardSummarization: React.FC<DashboardSummarizationProps> = ({
  tileConfigOverride,
}) => {
  const {
    extensionSDK,
    tileHostData,
    core40SDK,
    lookerHostData,
    isPreviewMode,
    isPreviewEditMode,
    setIsPreviewEditMode,
    setPreviewMountPoint,
  } = useExtensionHost();
  const {
    dashboardFilters,
    dashboardId,
    elementId,
    dashboardRunState,
    isDashboardEditing,
    lastRunStartTime,
  } = tileHostData;

  const {
    tileSummaries,
    setTileSummaries,
    executiveMarkdown,
    setExecutiveMarkdown,
    executiveStructured,
    setExecutiveStructured,
    setQuerySuggestions,
    toast,
    setToast,
    setDashboardURL,
  } = useContext(SummaryDataContext) as SummaryDataContextType;

  const [tileConfig, setTileConfig] = useState<TileConfiguration>(DEFAULT_TILE_CONFIG);
  const [tileConfigLoaded, setTileConfigLoaded] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [editSubView, setEditSubView] = useState<EditSubView>('config');

  const [dashboardMetadata, setDashboardMetadata] = useState<DashboardMetadata>({
    dashboardFilters: {},
    dashboardId: '',
    queries: [],
    description: '',
  });
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [loadingTilesProgress, setLoadingTilesProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [queryResults, setQueryResults] = useState<QueryWithData[]>([]);
  const [nextStepsInstructions, setNextStepsInstructions] = useState<string>(
    PRESET_PROMPTS[0].prompt
  );
  const [selectedPreset, setSelectedPreset] = useState<string | null>(PRESET_PROMPTS[0].id);

  const [generating, setGenerating] = useState(false);
  const [synthesizingExecutive, setSynthesizingExecutive] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('executive');
  const [isRefineOpen, setIsRefineOpen] = useState(false);
  const [loadingStates, setLoadingStates] = useState<LoadingStates>({});
  const [collapsedTiles, setCollapsedTiles] = useState<Record<number, boolean>>({});
  const [copiedBrief, setCopiedBrief] = useState(false);
  const [copiedTileIdx, setCopiedTileIdx] = useState<number | null>(null);
  const [summarizedSignature, setSummarizedSignature] = useState<string>('');

  const workspaceOauth = useWorkspaceOauth();
  const slackOauth = useSlackOauth();
  const restfulService = appConfig.RESTFUL_WEBSERVICE;

  const fetchSeqRef = useRef(0);
  const lastSeenRunStartRef = useRef<number | undefined>(undefined);
  const hasUserEditedPromptRef = useRef(false);
  const hasAutoRunInitialRef = useRef(false);
  const autoRanSignatureRef = useRef<string>('');
  const prevIsEditingRef = useRef<boolean>(Boolean(isDashboardEditing));

  const [refreshTick, setRefreshTick] = useState(0);
  const workspaceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    workspaceRef.current?.scrollTo?.({ top: 0 });
  }, [activeTab]);

  // Open Configuration Menu automatically whenever Looker enters Dashboard Edit mode.
  useEffect(() => {
    const editingNow = Boolean(isDashboardEditing);
    if (editingNow && !prevIsEditingRef.current) {
      setEditSubView('config');
      setIsRefineOpen(false);
    }
    prevIsEditingRef.current = editingNow;
  }, [isDashboardEditing]);

  // Load persisted TileConfiguration from Looker CustomerArtifactStore (with localStorage fallback),
  // or sync from tileConfigOverride when mounted inside StandaloneWorkspace.
  useEffect(() => {
    if (tileConfigOverride) {
      setTileConfig((prev) =>
        JSON.stringify(prev) === JSON.stringify(tileConfigOverride)
          ? prev
          : tileConfigOverride
      );
      if (!hasUserEditedPromptRef.current) {
        setNextStepsInstructions(tileConfigOverride.defaultPrompt);
        setSelectedPreset(tileConfigOverride.defaultPresetId);
      }
      setTileConfigLoaded(true);
      return;
    }

    if (!dashboardId || dashboardId === 'undefined') return;
    let cancelled = false;
    setTileConfigLoaded(false);

    loadTileConfig(core40SDK, extensionSDK, dashboardId, elementId, isPreviewMode)
      .then((loaded) => {
        if (cancelled) return;
        setTileConfig((prev) =>
          JSON.stringify(prev) === JSON.stringify(loaded) ? prev : loaded
        );
        if (!hasUserEditedPromptRef.current) {
          setNextStepsInstructions(loaded.defaultPrompt);
          setSelectedPreset(loaded.defaultPresetId);
        }
        setTileConfigLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setTileConfigLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [core40SDK, dashboardId, elementId, extensionSDK, isPreviewMode, tileConfigOverride]);

  const filtersKey = useMemo(
    () => serializeDashboardFilters(dashboardFilters),
    [dashboardFilters]
  );

  const stableFilters = useMemo<Filters>(
    () => JSON.parse(filtersKey) as Filters,
    [filtersKey]
  );

  const filterEntries = useMemo(
    () =>
      Object.entries(stableFilters).filter(
        ([, val]) => val !== undefined && val !== null && String(val).trim() !== ''
      ),
    [stableFilters]
  );

  const currentSignature = useMemo(
    () => `${dashboardId || ''}:${filtersKey}`,
    [dashboardId, filtersKey]
  );

  const filtersChangedSinceSummary =
    hasInitialized &&
    Boolean(summarizedSignature) &&
    summarizedSignature !== currentSignature &&
    !generating;

  useEffect(() => {
    if (lookerHostData?.hostUrl && dashboardId) {
      setDashboardURL(`${lookerHostData.hostUrl.replace(/\/+$/, '')}/dashboards/${dashboardId}`);
    }
  }, [lookerHostData?.hostUrl, dashboardId, setDashboardURL]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast, setToast]);

  useEffect(() => {
    if (dashboardRunState === 'RUNNING') {
      setGenerating(false);
    }
  }, [dashboardRunState]);

  useEffect(() => {
    if (lastRunStartTime == null) return;
    if (lastSeenRunStartRef.current === undefined) {
      lastSeenRunStartRef.current = lastRunStartTime;
      return;
    }
    if (lastSeenRunStartRef.current !== lastRunStartTime) {
      lastSeenRunStartRef.current = lastRunStartTime;
      clearQueryDataCache();
      setRefreshTick((prev) => prev + 1);
    }
  }, [lastRunStartTime]);

  // Load dashboard metadata only when dashboardId, canonical filter values, or an explicit dashboard Run changes.
  useEffect(() => {
    if (!dashboardId || dashboardId === 'undefined') return;
    const seq = ++fetchSeqRef.current;
    setLoadingMetadata(true);

    fetchDashboardDetails(dashboardId, core40SDK, extensionSDK, stableFilters)
      .then((metadata) => {
        if (seq !== fetchSeqRef.current) return;
        setDashboardMetadata(metadata);
      })
      .catch((error) => {
        if (seq !== fetchSeqRef.current) return;
        console.error('Error loading dashboard metadata:', error);
        setToast({
          type: 'error',
          text: 'Unable to load Looker dashboard metadata.',
        });
      })
      .finally(() => {
        if (seq === fetchSeqRef.current) {
          setLoadingMetadata(false);
        }
      });
  }, [dashboardId, filtersKey, stableFilters, refreshTick, core40SDK, extensionSDK, setToast]);

  // Execute dashboard tile queries with bounded concurrency whenever metadata updates.
  useEffect(() => {
    if (dashboardMetadata.queries.length === 0) {
      setQueryResults([]);
      setLoadingTilesProgress(null);
      return;
    }

    let cancelled = false;
    setLoadingTilesProgress({ completed: 0, total: dashboardMetadata.queries.length });

    fetchQueryData(dashboardMetadata.queries, core40SDK, {
      cacheKey: `${dashboardMetadata.dashboardId}:${serializeDashboardFilters(
        dashboardMetadata.dashboardFilters
      )}`,
      onProgress: (completed, total) => {
        if (!cancelled) {
          setLoadingTilesProgress(completed >= total ? null : { completed, total });
        }
      },
    })
      .then((results) => {
        if (!cancelled) {
          setQueryResults(results);
          setLoadingTilesProgress(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Error fetching dashboard tile data:', err);
          setLoadingTilesProgress(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dashboardMetadata, core40SDK]);

  const handlePresetSelect = (preset: PresetPrompt) => {
    hasUserEditedPromptRef.current = true;
    setSelectedPreset(preset.id);
    setNextStepsInstructions(preset.prompt);
  };

  const runSummarization = useCallback(
    async (promptOverride?: string) => {
      const effectivePrompt = (
        typeof promptOverride === 'string' ? promptOverride : nextStepsInstructions
      ).trim();
      if (!effectivePrompt || queryResults.length === 0) return;

      setGenerating(true);
      setHasInitialized(true);
      setIsRefineOpen(false);
      setTileSummaries([]);
      setExecutiveMarkdown('');
      setExecutiveStructured(null);
      setQuerySuggestions([]);
      setSummarizedSignature(currentSignature);

      try {
        const cards = await collateSummaries(
          queryResults,
          effectivePrompt,
          restfulService,
          extensionSDK,
          dashboardMetadata,
          {
            setTileSummaries,
            setExecutiveMarkdown,
            setExecutiveStructured,
            setQuerySuggestions,
            setLoadingStates,
            setSynthesizingExecutive,
          },
          {
            showNextSteps: tileConfig.showNextSteps,
            showFollowUpQuestions: tileConfig.showFollowUpQuestions,
            pipelineMode: tileConfig.pipelineMode,
          }
        );

        if (cards.length === 0) {
          const usesDefaultRunApp = /\.run\.app(?:\/|$)/i.test(restfulService);
          setToast({
            type: 'error',
            text: usesDefaultRunApp
              ? 'Could not reach Vertex AI backend: Looker Core serverProxy blocks default *.run.app domains. Configure a custom domain for Cloud Run.'
              : 'Could not generate insights. Verify the Vertex AI backend URL and secret configuration.',
          });
        }
      } catch (error) {
        console.error('Error running summarization pipeline:', error);
        setToast({
          type: 'error',
          text: 'An unexpected error occurred while generating dashboard insights.',
        });
      } finally {
        setGenerating(false);
        setSynthesizingExecutive(false);
      }
    },
    [
      currentSignature,
      dashboardMetadata,
      extensionSDK,
      nextStepsInstructions,
      queryResults,
      restfulService,
      setExecutiveMarkdown,
      setExecutiveStructured,
      setQuerySuggestions,
      setTileSummaries,
      setToast,
      tileConfig.showFollowUpQuestions,
      tileConfig.showNextSteps,
    ]
  );

  const isLoadingData = loadingMetadata || loadingTilesProgress !== null;
  const readyTileCount = queryResults.length;
  const showConfigPanel = Boolean(isDashboardEditing) && editSubView === 'config';

  // Auto-run controller: fires automatically on load (and optionally on filter changes) when configured.
  useEffect(() => {
    if (isDashboardEditing || !tileConfigLoaded || !tileConfig.autoRun) return;
    if (isLoadingData || queryResults.length === 0 || generating) return;

    if (!hasAutoRunInitialRef.current && !hasInitialized) {
      hasAutoRunInitialRef.current = true;
      autoRanSignatureRef.current = currentSignature;
      void runSummarization(tileConfig.defaultPrompt);
      return;
    }

    if (
      hasInitialized &&
      tileConfig.autoRefreshOnFilterChange &&
      summarizedSignature !== currentSignature &&
      autoRanSignatureRef.current !== currentSignature
    ) {
      autoRanSignatureRef.current = currentSignature;
      void runSummarization();
    }
  }, [
    currentSignature,
    generating,
    hasInitialized,
    isDashboardEditing,
    isLoadingData,
    queryResults.length,
    runSummarization,
    summarizedSignature,
    tileConfig.autoRefreshOnFilterChange,
    tileConfig.autoRun,
    tileConfig.defaultPrompt,
    tileConfigLoaded,
  ]);

  const handleSaveTileConfig = async (updated: TileConfiguration) => {
    setSavingConfig(true);
    try {
      const result = await saveTileConfig(
        core40SDK,
        extensionSDK,
        dashboardId,
        elementId,
        updated,
        isPreviewMode
      );
      setTileConfig(result.config);
      hasUserEditedPromptRef.current = false;
      setNextStepsInstructions(result.config.defaultPrompt);
      setSelectedPreset(result.config.defaultPresetId);
      if (!result.config.showFollowUpQuestions) {
        setQuerySuggestions([]);
      }
      if (!result.config.showNextSteps) {
        setExecutiveStructured((prev) =>
          prev ? { ...prev, recommendations: [] } : null
        );
      }
      // Allow auto-run to trigger cleanly when exiting edit mode if newly enabled
      if (result.config.autoRun && !hasInitialized) {
        hasAutoRunInitialRef.current = false;
      }
      setToast({
        type: 'success',
        text: result.persistedToArtifactStore
          ? 'Tile configuration saved for all dashboard viewers.'
          : 'Tile configuration saved.',
      });
    } catch {
      setToast({
        type: 'error',
        text: 'Unable to save tile configuration.',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const buildFullExportMarkdown = useCallback(() => {
    const sections: string[] = [];
    if (executiveMarkdown) {
      sections.push(executiveMarkdown);
    }
    if (tileSummaries.length > 0) {
      sections.push('## Tile-by-Tile Breakdown');
      for (const tile of tileSummaries) {
        sections.push(tile.markdown);
      }
    }
    return sections.join('\n\n');
  }, [executiveMarkdown, tileSummaries]);

  const handleCopyBrief = async () => {
    const md = buildFullExportMarkdown();
    if (!md) return;
    try {
      await extensionSDK.clipboardWrite(md);
    } catch {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
      }
    }
    setCopiedBrief(true);
    setToast({ type: 'success', text: 'Copied full Markdown brief to clipboard.' });
    setTimeout(() => setCopiedBrief(false), 2000);
  };

  const handleCopyTile = async (markdown: string, index: number) => {
    try {
      await extensionSDK.clipboardWrite(markdown);
    } catch {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(markdown);
      }
    }
    setCopiedTileIdx(index);
    setTimeout(() => setCopiedTileIdx((prev) => (prev === index ? null : prev)), 2000);
  };

  const showNextStepsSection =
    tileConfig.showNextSteps &&
    Boolean(executiveStructured && executiveStructured.recommendations.length > 0);
  const showKeyHighlightsSection = Boolean(
    executiveStructured && executiveStructured.keyHighlights.length > 0
  );

  return (
    <div className="ds-root">
      {/* Slim Single-Line Custom Header + Inline Tabs & Actions */}
      <header className="ds-slim-header">
        <div className="ds-slim-brand-nav">
          <div className="ds-slim-brand">
            <span className="ds-slim-icons" aria-hidden="true">
              <LookerRingsIcon size={14} />
              <span className="ds-brand-divider" />
              <GeminiSparkleIcon size={14} />
            </span>
            <h1 className="ds-slim-title">Dashboard Insights</h1>
            {isPreviewMode && <span className="ds-badge ds-badge-preview">Preview</span>}
            {isDashboardEditing && <span className="ds-badge ds-badge-edit">Edit Mode</span>}
          </div>

          {hasInitialized && !showConfigPanel && (
            <div className="ds-inline-tabs" role="tablist" aria-label="Summary views">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'executive'}
                className={`ds-inline-tab ${activeTab === 'executive' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('executive')}
              >
                <Sparkles size={13} />
                <span>Executive Brief</span>
                {synthesizingExecutive && <span className="ds-spinner-xs" />}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'tiles'}
                className={`ds-inline-tab ${activeTab === 'tiles' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('tiles')}
              >
                <LayoutGrid size={13} />
                <span>
                  Tiles ({tileSummaries.length}/{queryResults.length})
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="ds-slim-actions">
          {isPreviewMode && setPreviewMountPoint && !tileConfigOverride && (
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-btn-xs"
              onClick={() => setPreviewMountPoint('standalone')}
              title="Preview Standalone Split-Workspace Layout"
            >
              <LayoutGrid size={13} />
              <span>Standalone View</span>
            </button>
          )}

          {isPreviewMode && setIsPreviewEditMode && !tileConfigOverride && (
            <button
              type="button"
              className={`ds-btn ds-btn-xs ${
                isPreviewEditMode ? 'ds-btn-primary' : 'ds-btn-ghost'
              }`}
              onClick={() => setIsPreviewEditMode(!isPreviewEditMode)}
              title="Simulate Looker Dashboard Edit Mode"
            >
              <Settings2 size={13} />
              <span>{isPreviewEditMode ? 'Exit Edit' : 'Edit Tile'}</span>
            </button>
          )}

          {isDashboardEditing && (
            <button
              type="button"
              className="ds-btn ds-btn-secondary ds-btn-xs"
              onClick={() =>
                setEditSubView((prev) => (prev === 'config' ? 'preview' : 'config'))
              }
            >
              {editSubView === 'config' ? (
                <>
                  <Eye size={13} />
                  <span>Preview Tile</span>
                </>
              ) : (
                <>
                  <Settings2 size={13} />
                  <span>Configure Tile</span>
                </>
              )}
            </button>
          )}

          {(!hasInitialized || isLoadingData || showConfigPanel) && (
            <div className="ds-readiness-pill" aria-live="polite">
              {isLoadingData ? (
                <>
                  <span className="ds-spinner-xs" />
                  <span>
                    {loadingTilesProgress
                      ? `Loading tiles (${loadingTilesProgress.completed}/${loadingTilesProgress.total})`
                      : 'Inspecting dashboard...'}
                  </span>
                </>
              ) : readyTileCount > 0 ? (
                <>
                  <span className="ds-status-dot ds-status-ready" />
                  <span>
                    {readyTileCount} {readyTileCount === 1 ? 'tile' : 'tiles'} ready
                  </span>
                </>
              ) : (
                <>
                  <span className="ds-status-dot ds-status-idle" />
                  <span>Awaiting queries</span>
                </>
              )}
            </div>
          )}

          {hasInitialized && !showConfigPanel && (
            <div className="ds-toolbar-actions">
              <button
                type="button"
                className="ds-btn ds-btn-ghost ds-btn-xs"
                disabled={generating || isLoadingData || readyTileCount === 0}
                onClick={() => void runSummarization()}
                title="Refresh summary using current filters and prompt"
              >
                <RefreshCw size={13} className={generating ? 'ds-spin-icon' : undefined} />
                <span>Refresh</span>
              </button>

              {tileConfig.allowPromptOverride && (
                <button
                  type="button"
                  className="ds-btn ds-btn-secondary ds-btn-xs"
                  disabled={generating}
                  onClick={() => setIsRefineOpen(true)}
                  title="Customize prompt or switch analysis persona"
                >
                  <SlidersHorizontal size={13} />
                  <span>Refine</span>
                </button>
              )}

              <span className="ds-toolbar-sep" aria-hidden="true" />

              <button
                type="button"
                className="ds-btn ds-btn-ghost ds-btn-xs"
                disabled={generating || tileSummaries.length === 0}
                onClick={handleCopyBrief}
                title="Copy Markdown Brief"
              >
                {copiedBrief ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedBrief ? 'Copied' : 'Copy'}</span>
              </button>

              <button
                type="button"
                className="ds-btn ds-btn-ghost ds-btn-xs"
                disabled={generating || tileSummaries.length === 0}
                onClick={workspaceOauth}
                title="Share to Google Chat"
              >
                <GoogleChatBrandIcon size={13} />
                <span>Chat</span>
              </button>

              <button
                type="button"
                className="ds-btn ds-btn-ghost ds-btn-xs"
                disabled={generating || tileSummaries.length === 0}
                onClick={slackOauth}
                title="Share to Slack"
              >
                <SlackBrandIcon size={13} />
                <span>Slack</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Contextual Filter & Stale Summary Bar (rendered only when active) */}
      {!showConfigPanel && (filterEntries.length > 0 || filtersChangedSinceSummary) && (
        <div className="ds-context-bar">
          {filterEntries.length > 0 && (
            <div className="ds-filter-strip" aria-label="Active dashboard filters">
              <span className="ds-filter-label">
                <Filter size={11} />
                <span>Filters</span>
              </span>
              {filterEntries.map(([key, value]) => (
                <span key={key} className="ds-filter-chip">
                  <strong>{key}:</strong> {String(value)}
                </span>
              ))}
            </div>
          )}

          {filtersChangedSinceSummary && (
            <div className="ds-stale-banner" role="status">
              <div className="ds-stale-text">
                <RefreshCw size={13} />
                <span>Dashboard filters changed since this summary was generated.</span>
              </div>
              <div className="ds-stale-actions">
                {tileConfig.allowPromptOverride && (
                  <button
                    type="button"
                    className="ds-btn ds-btn-secondary ds-btn-xs"
                    onClick={() => setIsRefineOpen(true)}
                  >
                    <SlidersHorizontal size={12} />
                    <span>Edit Prompt</span>
                  </button>
                )}
                <button
                  type="button"
                  className="ds-btn ds-btn-primary ds-btn-xs"
                  onClick={() => void runSummarization()}
                >
                  <RefreshCw size={12} />
                  <span>Refresh Brief</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`ds-toast ds-toast-${toast.type}`} role="status">
          <span className="ds-toast-icon">
            {toast.type === 'success' ? (
              <CheckCircle2 size={15} />
            ) : toast.type === 'error' ? (
              <AlertCircle size={15} />
            ) : (
              <Info size={15} />
            )}
          </span>
          <span className="ds-toast-text">{toast.text}</span>
          <button
            type="button"
            className="ds-icon-btn"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Dashboard Edit Mode: Tile Configuration Menu */}
      {showConfigPanel ? (
        <TileConfigPanel
          config={tileConfig}
          saving={savingConfig}
          onSave={handleSaveTileConfig}
        />
      ) : !hasInitialized ? (
        tileConfigLoaded && tileConfig.autoRun ? (
          <main className="ds-workspace">
            <div className="ds-tab-panel">
              <div className="ds-skeleton-card" aria-busy="true">
                <div className="ds-skeleton-header">
                  <GeminiSparkleIcon size={17} />
                  <span>
                    {isLoadingData
                      ? 'Loading dashboard tile queries for automatic insights...'
                      : 'Starting automatic executive synthesis...'}
                  </span>
                </div>
                <div className="ds-shimmer-line ds-w-90" />
                <div className="ds-shimmer-line ds-w-80" />
                <div className="ds-shimmer-line ds-w-65" />
              </div>
            </div>
          </main>
        ) : (
          /* Space-Filling Fluid Persona Composer */
          <main className="ds-landing">
            <div className="ds-composer-card">
              <div className="ds-composer-split">
                <div className="ds-composer-lens-col">
                  <div className="ds-composer-intro">
                    <h2>Choose an Analysis Lens</h2>
                    <p>
                      Select a persona or customize instructions for Gemini to evaluate across every
                      tile.
                    </p>
                  </div>

                  <div className="ds-preset-grid" role="radiogroup" aria-label="Analysis persona">
                    {PRESET_PROMPTS.map((preset) => {
                      const Icon = preset.icon;
                      const isSelected = selectedPreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          className={`ds-preset-card ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => handlePresetSelect(preset)}
                        >
                          <div className="ds-preset-card-top">
                            <span className="ds-preset-icon">
                              <Icon size={15} />
                            </span>
                            <span className="ds-preset-title">{preset.title}</span>
                          </div>
                          <p className="ds-preset-desc">{preset.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="ds-composer-prompt-col">
                  <label className="ds-field-label" htmlFor="ds-prompt-input">
                    Business Context &amp; Focus Instructions
                  </label>
                  <textarea
                    id="ds-prompt-input"
                    className="ds-textarea ds-composer-textarea"
                    rows={3}
                    maxLength={MAX_PROMPT_LENGTH}
                    value={nextStepsInstructions}
                    disabled={!tileConfig.allowPromptOverride}
                    onChange={(e) => {
                      hasUserEditedPromptRef.current = true;
                      setNextStepsInstructions(e.target.value);
                      setSelectedPreset(null);
                    }}
                    placeholder="Describe business goals, target thresholds, or decisions this summary should support..."
                  />

                  <div className="ds-composer-footer">
                    {dashboardMetadata.description && (
                      <span className="ds-context-hint" title={dashboardMetadata.description}>
                        Includes dashboard description context
                      </span>
                    )}
                    <button
                      type="button"
                      className="ds-btn ds-btn-primary"
                      disabled={
                        generating ||
                        isLoadingData ||
                        readyTileCount === 0 ||
                        !nextStepsInstructions.trim()
                      }
                      onClick={() => void runSummarization()}
                    >
                      <Sparkles size={15} />
                      <span>
                        {isLoadingData
                          ? 'Preparing Tile Data...'
                          : generating
                            ? 'Generating Insights...'
                            : 'Generate Insights'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </main>
        )
      ) : (
        /* Results Workspace */
        <>
          <main ref={workspaceRef} className={`ds-workspace ${isRefineOpen ? 'is-blurred' : ''}`}>
            {activeTab === 'executive' ? (
              <div className="ds-tab-panel">
                {synthesizingExecutive && !executiveStructured && !executiveMarkdown ? (
                  <div className="ds-skeleton-card" aria-busy="true">
                    <div className="ds-skeleton-header">
                      <GeminiSparkleIcon size={17} />
                      <span>
                        Synthesizing executive brief across {queryResults.length} dashboard tiles...
                      </span>
                    </div>
                    <div className="ds-shimmer-line ds-w-90" />
                    <div className="ds-shimmer-line ds-w-80" />
                    <div className="ds-shimmer-line ds-w-65" />
                    <p className="ds-skeleton-subhint">
                      Switch to <strong>Tiles</strong> in the top bar anytime to inspect individual
                      tile summaries as they stream in.
                    </p>
                  </div>
                ) : executiveStructured ? (
                  <div className="ds-exec-stack">
                    <section className="ds-hero-card">
                      <div className="ds-hero-kicker">
                        <GeminiSparkleIcon size={14} />
                        <span>Executive Overview</span>
                      </div>
                      <p className="ds-hero-overview">{executiveStructured.executiveOverview}</p>
                    </section>

                    {(showKeyHighlightsSection || showNextStepsSection) && (
                      <div
                        className={`ds-exec-columns ${
                          showKeyHighlightsSection && showNextStepsSection ? 'has-two-cols' : ''
                        }`}
                      >
                        {showKeyHighlightsSection && (
                          <section className="ds-card">
                            <h2 className="ds-card-heading">Key Findings</h2>
                            <div className="ds-highlights-grid">
                              {executiveStructured.keyHighlights.map((item, idx) => (
                                <div key={idx} className="ds-highlight-item">
                                  <div className="ds-highlight-header">
                                    <span className={`ds-badge ds-badge-${item.impact}`}>
                                      {item.impact === 'positive'
                                        ? 'Positive'
                                        : item.impact === 'negative'
                                          ? 'Attention'
                                          : 'Insight'}
                                    </span>
                                    <h3>{item.headline}</h3>
                                  </div>
                                  <p>{item.detail}</p>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}

                        {showNextStepsSection && (
                          <section className="ds-card">
                            <h2 className="ds-card-heading">Recommended Next Steps</h2>
                            <ol className="ds-recommendations-list">
                              {executiveStructured.recommendations.map((rec, idx) => (
                                <li key={idx} className="ds-recommendation-item">
                                  <span
                                    className={`ds-priority-pill ${
                                      rec.priority === 'high' ? 'is-high' : 'is-medium'
                                    }`}
                                  >
                                    {rec.priority === 'high' ? 'High Priority' : 'Follow-Up'}
                                  </span>
                                  <div className="ds-recommendation-content">
                                    <strong>{rec.action}</strong>
                                    <p>{rec.rationale}</p>
                                  </div>
                                </li>
                              ))}
                            </ol>
                          </section>
                        )}
                      </div>
                    )}

                    {tileConfig.showFollowUpQuestions && <QuerySuggestions />}
                  </div>
                ) : executiveMarkdown ? (
                  <div className="ds-exec-stack">
                    <section className="ds-card">
                      <MarkdownComponent data={[executiveMarkdown]} />
                    </section>
                    {tileConfig.showFollowUpQuestions && <QuerySuggestions />}
                  </div>
                ) : (
                  <div className="ds-empty-state">
                    <p>
                      No executive summary generated yet. Use <strong>Refresh</strong> or{' '}
                      <strong>Refine</strong> in the top bar to generate a new summary.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="ds-tab-panel ds-tiles-list">
                {queryResults.map((queryItem, idx) => {
                  const card = tileSummaries.find((t) => t.index === idx);
                  const isTileLoading = Boolean(loadingStates[`query-${idx}`]);
                  const isCollapsed = Boolean(collapsedTiles[idx]);

                  if (isTileLoading && !card) {
                    return (
                      <div key={idx} className="ds-skeleton-card" aria-busy="true">
                        <div className="ds-skeleton-header">
                          <span className="ds-spinner-xs" />
                          <span>Analyzing tile: {queryItem.title}</span>
                        </div>
                        <div className="ds-shimmer-line ds-w-85" />
                        <div className="ds-shimmer-line ds-w-70" />
                      </div>
                    );
                  }

                  if (!card) return null;

                  return (
                    <article key={idx} className="ds-tile-card">
                      <header className="ds-tile-card-header">
                        <div className="ds-tile-title-wrap">
                          <span className="ds-tile-index">{idx + 1}</span>
                          <div>
                            <h3 className="ds-tile-title">{card.title}</h3>
                            {card.noteText && <p className="ds-tile-note">{card.noteText}</p>}
                          </div>
                        </div>

                        <div className="ds-tile-actions">
                          <button
                            type="button"
                            className="ds-icon-btn"
                            title="Copy tile summary"
                            aria-label={`Copy summary for ${card.title}`}
                            onClick={() => handleCopyTile(card.markdown, idx)}
                          >
                            {copiedTileIdx === idx ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                          <button
                            type="button"
                            className="ds-icon-btn"
                            aria-label={
                              isCollapsed ? 'Expand tile summary' : 'Collapse tile summary'
                            }
                            onClick={() =>
                              setCollapsedTiles((prev) => ({
                                ...prev,
                                [idx]: !prev[idx],
                              }))
                            }
                          >
                            {isCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                          </button>
                        </div>
                      </header>

                      {!isCollapsed && (
                        <div className="ds-tile-body">
                          <MarkdownComponent
                            data={[stripRedundantTileHeading(card.markdown, card.title)]}
                          />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </main>

          {/* Refine Prompt Modal Backdrop & Drawer */}
          {isRefineOpen && (
            <>
              <div
                className="ds-backdrop"
                onClick={() => setIsRefineOpen(false)}
                aria-hidden="true"
              />
              <section
                className="ds-refine-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="Refine summary instructions"
              >
                <div className="ds-refine-header">
                  <h3>Refine Analysis Focus</h3>
                  <button
                    type="button"
                    className="ds-icon-btn"
                    aria-label="Close refine dialog"
                    onClick={() => setIsRefineOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="ds-preset-pills-row">
                  {PRESET_PROMPTS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`ds-pill-btn ${selectedPreset === preset.id ? 'is-selected' : ''}`}
                      onClick={() => handlePresetSelect(preset)}
                    >
                      {preset.title}
                    </button>
                  ))}
                </div>

                <textarea
                  className="ds-textarea"
                  rows={4}
                  maxLength={MAX_PROMPT_LENGTH}
                  value={nextStepsInstructions}
                  onChange={(e) => {
                    hasUserEditedPromptRef.current = true;
                    setNextStepsInstructions(e.target.value);
                    setSelectedPreset(null);
                  }}
                  placeholder="Provide updated business context or specific questions to trigger a new summary..."
                />

                <div className="ds-refine-actions">
                  <button
                    type="button"
                    className="ds-btn ds-btn-secondary"
                    onClick={() => setIsRefineOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="ds-btn ds-btn-primary"
                    disabled={generating || !nextStepsInstructions.trim()}
                    onClick={() => void runSummarization()}
                  >
                    <RefreshCw size={14} />
                    <span>{generating ? 'Regenerating...' : 'Regenerate Brief'}</span>
                  </button>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
};
