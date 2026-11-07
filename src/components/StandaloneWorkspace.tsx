import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Columns2,
  ExternalLink,
  Filter,
  LayoutDashboard,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { getEmbedSDK, type ILookerConnection } from '@looker/embed-sdk';
import {
  DashboardRunState,
  type Filters,
  type TileHostData,
} from '@looker/extension-sdk';
import {
  ExtensionHostContext,
  useExtensionHost,
  type ExtensionHostContextValue,
} from '../contexts/ExtensionHostContext';
import { SummaryDataContext } from '../contexts/SummaryDataContext';
import type {
  DrawerWidthMode,
  StandaloneWorkspaceConfig,
  SummaryDataContextType,
} from '../types';
import { serializeDashboardFilters } from '../utils/fetchDashboardDetails';
import { clearQueryDataCache } from '../utils/fetchQueryData';
import {
  buildStandaloneRoute,
  DEFAULT_STANDALONE_CONFIG,
  extractFiltersFromEmbedUrl,
  loadStandaloneConfig,
  parseDashboardInput,
  saveStandaloneConfig,
} from '../utils/standaloneConfigStorage';
import { saveTileConfig } from '../utils/tileConfigStorage';
import { GeminiSparkleIcon, LookerRingsIcon } from './BrandIcons';
import { DashboardSummarization } from './DashboardSummarization';
import { StandaloneSettingsModal } from './StandaloneSettingsModal';

export const StandaloneWorkspace: React.FC = () => {
  const hostContext = useExtensionHost();
  const {
    extensionSDK,
    core40SDK,
    lookerHostData,
    isPreviewMode,
    previewMountPoint,
    setPreviewMountPoint,
    extensionRoute,
    updateExtensionRoute,
  } = hostContext;

  const {
    tileSummaries,
    setTileSummaries,
    setExecutiveMarkdown,
    executiveStructured,
    setExecutiveStructured,
    setQuerySuggestions,
    setToast,
  } = useContext(SummaryDataContext) as SummaryDataContextType;

  const [workspaceConfig, setWorkspaceConfig] = useState<StandaloneWorkspaceConfig>(
    DEFAULT_STANDALONE_CONFIG
  );
  const [configLoaded, setConfigLoaded] = useState<boolean>(false);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  const [activeDashboardId, setActiveDashboardId] = useState<string>('');
  const [activeDashboardTitle, setActiveDashboardTitle] = useState<string>('');
  const [activeFilters, setActiveFilters] = useState<Filters>({
    Timeframe: 'Last 90 Days',
    Segment: 'All Segments',
  });
  const [embeddedRunState, setEmbeddedRunState] = useState<DashboardRunState>(
    DashboardRunState.NOT_RUNNING
  );
  const [lastRunStartTime, setLastRunStartTime] = useState<number | undefined>(
    undefined
  );

  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(true);
  const [drawerWidth, setDrawerWidth] = useState<DrawerWidthMode>('standard');

  const [embedLoading, setEmbedLoading] = useState<boolean>(false);
  const [embedError, setEmbedError] = useState<string | null>(null);

  const embedContainerRef = useRef<HTMLDivElement | null>(null);
  const connectionRef = useRef<ILookerConnection | null>(null);
  const initialFiltersForDashboardRef = useRef<Filters>({});
  const hasBootstrappedRef = useRef<boolean>(false);
  const lastSyncedRouteRef = useRef<string>('');

  const resetSummaryOutputs = useCallback(() => {
    setTileSummaries([]);
    setExecutiveMarkdown('');
    setExecutiveStructured(null);
    setQuerySuggestions([]);
  }, [
    setExecutiveMarkdown,
    setExecutiveStructured,
    setQuerySuggestions,
    setTileSummaries,
  ]);

  // 1. Load persisted standalone workspace configuration and resolve initial route/dashboard.
  useEffect(() => {
    if (hasBootstrappedRef.current) return;
    let cancelled = false;

    const routeParsed = parseDashboardInput(extensionRoute);

    loadStandaloneConfig(core40SDK, extensionSDK, isPreviewMode)
      .then((loaded) => {
        if (cancelled) return;
        hasBootstrappedRef.current = true;
        setWorkspaceConfig(loaded);
        setIsDrawerOpen(loaded.defaultDrawerOpen);
        setDrawerWidth(loaded.drawerWidth);

        const forceEmptyPreview =
          isPreviewMode &&
          typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('empty') === '1';

        const initialId =
          routeParsed.dashboardId ||
          loaded.defaultDashboardId ||
          (isPreviewMode && !forceEmptyPreview ? 'preview_exec_pulse' : '');

        const initialTitle =
          initialId === loaded.defaultDashboardId && loaded.defaultDashboardTitle
            ? loaded.defaultDashboardTitle
            : initialId === 'preview_exec_pulse'
              ? 'Executive Business Pulse (Preview)'
              : '';

        if (Object.keys(routeParsed.filters).length > 0) {
          initialFiltersForDashboardRef.current = routeParsed.filters;
          setActiveFilters(routeParsed.filters);
        } else if (!isPreviewMode) {
          initialFiltersForDashboardRef.current = {};
          setActiveFilters({});
        }

        setActiveDashboardId(initialId);
        setActiveDashboardTitle(initialTitle);
        setConfigLoaded(true);

        if (!initialId) {
          setIsSettingsOpen(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          hasBootstrappedRef.current = true;
          setConfigLoaded(true);
          if (!routeParsed.dashboardId) {
            setIsSettingsOpen(true);
          } else {
            setActiveDashboardId(routeParsed.dashboardId);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [core40SDK, extensionRoute, extensionSDK, isPreviewMode]);

  // 2. React to external host route changes (e.g. browser back/forward navigation).
  useEffect(() => {
    if (!configLoaded || !extensionRoute) return;
    if (extensionRoute === lastSyncedRouteRef.current) return;

    const parsed = parseDashboardInput(extensionRoute);
    if (parsed.dashboardId && parsed.dashboardId !== activeDashboardId) {
      resetSummaryOutputs();
      initialFiltersForDashboardRef.current = parsed.filters;
      setActiveDashboardId(parsed.dashboardId);
      setActiveDashboardTitle('');
      if (Object.keys(parsed.filters).length > 0) {
        setActiveFilters(parsed.filters);
      }
    }
  }, [activeDashboardId, configLoaded, extensionRoute, resetSummaryOutputs]);

  // 3. Synchronize activeDashboardId and activeFilters back to the Looker extension URL route.
  const filtersKey = useMemo(
    () => serializeDashboardFilters(activeFilters),
    [activeFilters]
  );

  useEffect(() => {
    if (!configLoaded || !activeDashboardId) return;
    const nextRoute = buildStandaloneRoute(activeDashboardId, activeFilters);
    if (nextRoute !== lastSyncedRouteRef.current) {
      lastSyncedRouteRef.current = nextRoute;
      updateExtensionRoute?.(nextRoute);
    }
  }, [activeDashboardId, activeFilters, configLoaded, filtersKey, updateExtensionRoute]);

  // 4. Resolve dashboard title via Looker SDK when not yet populated.
  useEffect(() => {
    if (!activeDashboardId || isPreviewMode || !core40SDK) return;
    if (typeof core40SDK.dashboard !== 'function') return;

    let cancelled = false;
    Promise.resolve(core40SDK.dashboard(activeDashboardId, 'id,title'))
      .then(async (rawResp) => {
        const dash =
          typeof core40SDK.ok === 'function' ? await core40SDK.ok(rawResp) : rawResp;
        if (!cancelled && dash && typeof dash === 'object' && 'title' in dash && dash.title) {
          setActiveDashboardTitle(String(dash.title));
        }
      })
      .catch(() => {
        // Ignore title lookup error
      });

    return () => {
      cancelled = true;
    };
  }, [activeDashboardId, core40SDK, isPreviewMode]);

  // 5. Update document/Looker window title.
  useEffect(() => {
    if (!activeDashboardId) return;
    const label = activeDashboardTitle || `Dashboard #${activeDashboardId}`;
    extensionSDK.updateTitle?.(`${label} — Dashboard Insights`);
  }, [activeDashboardId, activeDashboardTitle, extensionSDK]);

  // 6. Mount embedded Looker dashboard via @looker/embed-sdk (Looker Extension Framework guide + lkrdev/dashboard-tabs).
  useEffect(() => {
    if (isPreviewMode || !activeDashboardId) {
      setEmbedLoading(false);
      setEmbedError(null);
      return;
    }

    const el = embedContainerRef.current;
    const hostUrl = lookerHostData?.hostUrl;
    if (!el || !hostUrl) return;

    let cancelled = false;
    el.innerHTML = '';
    setEmbedLoading(true);
    setEmbedError(null);

    const canceller = () => ({ cancel: true });

    try {
      const embedSDK = getEmbedSDK();
      embedSDK.init(hostUrl);

      const builder = embedSDK
        .createDashboardWithId(activeDashboardId)
        .appendTo(el)
        .on(
          'dashboard:loaded',
          (event: {
            dashboard?: {
              title?: string;
              dashboard_filters?: Filters;
              options?: { layouts?: unknown };
            };
          }) => {
            if (cancelled) return;
            setEmbedLoading(false);
            if (event?.dashboard?.title) {
              setActiveDashboardTitle(String(event.dashboard.title));
            }
            if (event?.dashboard?.dashboard_filters) {
              const incomingFilters = event.dashboard.dashboard_filters;
              setActiveFilters((prev) =>
                serializeDashboardFilters(prev) ===
                serializeDashboardFilters(incomingFilters)
                  ? prev
                  : incomingFilters
              );
            }
          }
        )
        .on('dashboard:run:start', () => {
          if (cancelled) return;
          setEmbeddedRunState(DashboardRunState.RUNNING);
          setLastRunStartTime(Date.now());
        })
        .on('dashboard:run:complete', () => {
          if (cancelled) return;
          setEmbeddedRunState(DashboardRunState.NOT_RUNNING);
        })
        .on(
          'dashboard:filters:changed',
          (event: { dashboard?: { dashboard_filters?: Filters } }) => {
            if (cancelled) return;
            if (event?.dashboard?.dashboard_filters) {
              const nextFilters = event.dashboard.dashboard_filters;
              setActiveFilters((prev) =>
                serializeDashboardFilters(prev) === serializeDashboardFilters(nextFilters)
                  ? prev
                  : nextFilters
              );
            }
          }
        )
        .on('page:changed', (event: { page?: { absoluteUrl?: string } }) => {
          if (cancelled) return;
          if (event?.page?.absoluteUrl) {
            const urlFilters = extractFiltersFromEmbedUrl(event.page.absoluteUrl);
            if (Object.keys(urlFilters).length > 0) {
              setActiveFilters((prev) => {
                const merged: Filters = { ...prev, ...urlFilters };
                return serializeDashboardFilters(prev) ===
                  serializeDashboardFilters(merged)
                  ? prev
                  : merged;
              });
            }
          }
        })
        .on('drillmenu:click', canceller)
        .on('drillmodal:explore', canceller)
        .on('dashboard:tile:explore', canceller)
        .on('dashboard:tile:view', canceller);

      const initialParams = initialFiltersForDashboardRef.current;
      if (initialParams && Object.keys(initialParams).length > 0) {
        builder.withParams(initialParams as Record<string, string>);
      }

      builder
        .build()
        .connect()
        .then((connection: ILookerConnection) => {
          if (cancelled) return;
          connectionRef.current = connection;
          setEmbedLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          console.error('Error connecting to embedded Looker dashboard:', err);
          setEmbedLoading(false);
          setEmbedError(
            err instanceof Error
              ? err.message
              : 'Unable to embed Looker dashboard. Check manifest.lkml use_embeds / use_iframes entitlements.'
          );
        });
    } catch (err: unknown) {
      setEmbedLoading(false);
      setEmbedError(
        err instanceof Error
          ? err.message
          : 'Failed to initialize Looker Embed SDK.'
      );
    }

    return () => {
      cancelled = true;
      connectionRef.current = null;
      if (el) {
        el.innerHTML = '';
      }
    };
  }, [activeDashboardId, isPreviewMode, lookerHostData?.hostUrl]);

  const applyDashboardSelection = useCallback(
    (
      nextDashboardId: string,
      nextTitle: string,
      extractedFilters: Filters,
      nextConfig: StandaloneWorkspaceConfig
    ) => {
      const dashChanged = nextDashboardId !== activeDashboardId;
      if (dashChanged) {
        resetSummaryOutputs();
        clearQueryDataCache();
      }
      if (Object.keys(extractedFilters).length > 0) {
        initialFiltersForDashboardRef.current = extractedFilters;
        setActiveFilters(extractedFilters);
      } else if (dashChanged && !isPreviewMode) {
        initialFiltersForDashboardRef.current = {};
        setActiveFilters({});
      }

      setWorkspaceConfig(nextConfig);
      setIsDrawerOpen(nextConfig.defaultDrawerOpen);
      setDrawerWidth(nextConfig.drawerWidth);
      setActiveDashboardId(nextDashboardId);
      setActiveDashboardTitle(nextTitle);
      setIsSettingsOpen(false);
    },
    [activeDashboardId, isPreviewMode, resetSummaryOutputs]
  );

  const handleSaveDefaultAndLoad = async (
    nextDashboardId: string,
    nextTitle: string,
    extractedFilters: Filters,
    nextConfig: StandaloneWorkspaceConfig
  ) => {
    setSavingSettings(true);
    try {
      const saved = await saveStandaloneConfig(
        core40SDK,
        extensionSDK,
        nextConfig,
        isPreviewMode
      );
      await saveTileConfig(
        core40SDK,
        extensionSDK,
        nextDashboardId,
        'standalone_drawer',
        saved.config.tileConfig,
        isPreviewMode
      );
      applyDashboardSelection(
        nextDashboardId,
        nextTitle,
        extractedFilters,
        saved.config
      );
      setToast({
        type: 'success',
        text: saved.persistedToArtifactStore
          ? 'Saved default workspace dashboard and drawer settings.'
          : 'Workspace settings applied.',
      });
    } catch {
      setToast({
        type: 'error',
        text: 'Unable to persist standalone workspace settings.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleOpenInLooker = () => {
    if (!activeDashboardId) return;
    const baseUrl = (lookerHostData?.hostUrl || 'https://looker.example.com').replace(
      /\/+$/,
      ''
    );
    extensionSDK.openBrowserWindow(
      `${baseUrl}/dashboards/${encodeURIComponent(activeDashboardId)}`,
      '_blank'
    );
  };

  const toggleDrawerWidth = () => {
    setDrawerWidth((prev) => (prev === 'standard' ? 'wide' : 'standard'));
  };

  // Construct synthetic TileHostData for the right-hand drawer's <DashboardSummarization />
  const drawerTileHostData = useMemo<TileHostData>(
    () => ({
      dashboardId: activeDashboardId || undefined,
      elementId: 'standalone_drawer',
      dashboardFilters: activeFilters,
      dashboardRunState: embeddedRunState,
      isDashboardEditing: false,
      lastRunStartTime,
    }),
    [activeDashboardId, activeFilters, embeddedRunState, lastRunStartTime]
  );

  const drawerHostContextValue = useMemo<ExtensionHostContextValue>(
    () => ({
      ...hostContext,
      tileHostData: drawerTileHostData,
      isStandaloneMount: false,
    }),
    [drawerTileHostData, hostContext]
  );

  const hasSummaryReady =
    Boolean(executiveStructured) || tileSummaries.length > 0;

  return (
    <div className="ds-standalone-shell">
      {/* Top Standalone Workspace Navigation Bar */}
      <header className="ds-standalone-topbar">
        <div className="ds-standalone-topbar-left">
          <div className="ds-slim-brand">
            <span className="ds-slim-icons" aria-hidden="true">
              <LookerRingsIcon size={14} />
              <span className="ds-brand-divider" />
              <GeminiSparkleIcon size={14} />
            </span>
            <span className="ds-standalone-app-title">Dashboard Workspace</span>
            {isPreviewMode && (
              <span className="ds-badge ds-badge-preview">Preview</span>
            )}
          </div>

          <span className="ds-toolbar-sep" aria-hidden="true" />

          <button
            type="button"
            className="ds-dashboard-selector-btn"
            onClick={() => setIsSettingsOpen(true)}
            title="Switch embedded Looker dashboard or configure workspace settings"
          >
            <LayoutDashboard size={13} className="ds-accent-icon" />
            <span className="ds-dashboard-selector-name">
              {activeDashboardId
                ? activeDashboardTitle || `Dashboard #${activeDashboardId}`
                : 'Select a Looker Dashboard...'}
            </span>
            {activeDashboardId && (
              <code className="ds-dashboard-id-pill">#{activeDashboardId}</code>
            )}
          </button>
        </div>

        <div className="ds-standalone-topbar-right">
          {isPreviewMode && setPreviewMountPoint && (
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-btn-xs"
              onClick={() =>
                setPreviewMountPoint(
                  previewMountPoint === 'standalone' ? 'tile' : 'standalone'
                )
              }
              title="Switch between Standalone Split-Workspace and Dashboard Tile mount in preview"
            >
              <Columns2 size={13} />
              <span>View Tile Mount</span>
            </button>
          )}

          <button
            type="button"
            className="ds-btn ds-btn-secondary ds-btn-xs"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings2 size={13} />
            <span>Workspace Settings</span>
          </button>

          {activeDashboardId && (
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-btn-xs"
              onClick={handleOpenInLooker}
              title="Open native Looker dashboard in a new tab"
            >
              <ExternalLink size={13} />
              <span>Open in Looker</span>
            </button>
          )}

          <span className="ds-toolbar-sep" aria-hidden="true" />

          {isDrawerOpen && (
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-btn-xs"
              onClick={toggleDrawerWidth}
              title={
                drawerWidth === 'standard'
                  ? 'Expand Insights drawer to Wide (660px)'
                  : 'Return Insights drawer to Standard (500px)'
              }
            >
              {drawerWidth === 'standard' ? (
                <>
                  <Maximize2 size={13} />
                  <span>Wide Drawer</span>
                </>
              ) : (
                <>
                  <Columns2 size={13} />
                  <span>Standard Width</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            className={`ds-btn ds-btn-xs ${
              isDrawerOpen ? 'ds-btn-primary' : 'ds-btn-secondary'
            }`}
            aria-expanded={isDrawerOpen}
            aria-controls="ds-standalone-insights-drawer"
            onClick={() => setIsDrawerOpen((prev) => !prev)}
          >
            {isDrawerOpen ? (
              <>
                <PanelRightClose size={13} />
                <span>Collapse Insights</span>
              </>
            ) : (
              <>
                <PanelRightOpen size={13} />
                <span>Expand Insights</span>
                {hasSummaryReady && (
                  <span className="ds-drawer-ready-dot" aria-label="Insights ready" />
                )}
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Split-Screen Body: Left Embedded Dashboard Canvas + Right Collapsible AI Drawer */}
      <div className="ds-standalone-body">
        <main
          className="ds-standalone-canvas"
          aria-label="Embedded Looker Dashboard Canvas"
        >
          {!activeDashboardId ? (
            <div className="ds-standalone-empty-canvas">
              <div className="ds-standalone-empty-card">
                <div className="ds-standalone-empty-icon">
                  <LayoutDashboard size={22} />
                </div>
                <h2>No Looker Dashboard Selected</h2>
                <p>
                  Choose a Looker dashboard to embed on the main canvas and analyze with the
                  right-hand Gemini Insights drawer, or append{' '}
                  <code>?dashboard_id=&lt;id&gt;</code> to the URL.
                </p>
                <button
                  type="button"
                  className="ds-btn ds-btn-primary"
                  onClick={() => setIsSettingsOpen(true)}
                >
                  <Settings2 size={14} />
                  <span>Select Dashboard</span>
                </button>
              </div>
            </div>
          ) : isPreviewMode ? (
            /* Interactive Simulated Embedded Dashboard Canvas for ?preview=1&mount=standalone */
            <div className="ds-preview-embed-canvas">
              <div className="ds-preview-embed-toolbar">
                <div className="ds-preview-embed-title">
                  <span className="ds-badge ds-badge-neutral">Embedded Looker Canvas</span>
                  <h2>{activeDashboardTitle || `Dashboard #${activeDashboardId}`}</h2>
                </div>

                <div className="ds-preview-embed-filters">
                  <span className="ds-filter-label">
                    <Filter size={11} />
                    <span>Live Filters</span>
                  </span>

                  <label className="ds-preview-filter-control">
                    <span>Timeframe</span>
                    <select
                      aria-label="Embedded Dashboard Timeframe Filter"
                      value={String(activeFilters.Timeframe || 'Last 90 Days')}
                      onChange={(e) =>
                        setActiveFilters((prev) => ({
                          ...prev,
                          Timeframe: e.target.value,
                        }))
                      }
                    >
                      <option value="Last 90 Days">Last 90 Days</option>
                      <option value="Last 30 Days">Last 30 Days</option>
                      <option value="Year to Date">Year to Date</option>
                      <option value="Last 12 Months">Last 12 Months</option>
                    </select>
                  </label>

                  <label className="ds-preview-filter-control">
                    <span>Segment</span>
                    <select
                      aria-label="Embedded Dashboard Segment Filter"
                      value={String(activeFilters.Segment || 'All Segments')}
                      onChange={(e) =>
                        setActiveFilters((prev) => ({
                          ...prev,
                          Segment: e.target.value,
                        }))
                      }
                    >
                      <option value="All Segments">All Segments</option>
                      <option value="Strategic Enterprise">Strategic Enterprise</option>
                      <option value="Mid-Market">Mid-Market</option>
                      <option value="Commercial">Commercial</option>
                    </select>
                  </label>

                  <button
                    type="button"
                    className="ds-btn ds-btn-primary ds-btn-xs"
                    onClick={() => {
                      setEmbeddedRunState(DashboardRunState.RUNNING);
                      setLastRunStartTime(Date.now());
                      setTimeout(
                        () => setEmbeddedRunState(DashboardRunState.NOT_RUNNING),
                        350
                      );
                    }}
                  >
                    <Play size={12} />
                    <span>Run Dashboard</span>
                  </button>
                </div>
              </div>

              <div className="ds-preview-kpi-grid">
                <div className="ds-preview-kpi-card">
                  <span className="ds-preview-kpi-label">Total Net Revenue</span>
                  <strong className="ds-preview-kpi-value">$8.95M</strong>
                  <span className="ds-badge ds-badge-positive">+14.2% YoY</span>
                </div>
                <div className="ds-preview-kpi-card">
                  <span className="ds-preview-kpi-label">Blended Gross Margin</span>
                  <strong className="ds-preview-kpi-value">61.8%</strong>
                  <span className="ds-badge ds-badge-positive">+180 bps vs Target</span>
                </div>
                <div className="ds-preview-kpi-card">
                  <span className="ds-preview-kpi-label">Enterprise Net Dollar Retention</span>
                  <strong className="ds-preview-kpi-value">118.0%</strong>
                  <span className="ds-badge ds-badge-neutral">Strategic Tier</span>
                </div>
                <div className="ds-preview-kpi-card">
                  <span className="ds-preview-kpi-label">At-Risk ARR (SLA Breaches)</span>
                  <strong className="ds-preview-kpi-value">$1.11M</strong>
                  <span className="ds-badge ds-badge-negative">Mid-Market Concentration</span>
                </div>
              </div>

              <div className="ds-preview-tiles-grid">
                <article className="ds-preview-tile-card">
                  <header>
                    <h3>Quarterly Revenue &amp; Margin by Region</h3>
                    <span>orders.region &bull; order_items.total_revenue</span>
                  </header>
                  <table className="ds-preview-table">
                    <thead>
                      <tr>
                        <th>Region</th>
                        <th>Total Revenue</th>
                        <th>Gross Margin</th>
                        <th>YoY Growth</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>North America</td>
                        <td>$4,820,000</td>
                        <td>64.0%</td>
                        <td className="is-pos">+21.0%</td>
                      </tr>
                      <tr>
                        <td>EMEA</td>
                        <td>$2,390,000</td>
                        <td>58.0%</td>
                        <td className="is-neg">-4.0%</td>
                      </tr>
                      <tr>
                        <td>APAC</td>
                        <td>$1,740,000</td>
                        <td>61.0%</td>
                        <td className="is-pos">+16.0%</td>
                      </tr>
                    </tbody>
                  </table>
                </article>

                <article className="ds-preview-tile-card">
                  <header>
                    <h3>Acquisition Pipeline &amp; Conversion by Channel</h3>
                    <span>attribution.channel &bull; attribution.conversion_rate</span>
                  </header>
                  <table className="ds-preview-table">
                    <thead>
                      <tr>
                        <th>Channel</th>
                        <th>Qualified Leads</th>
                        <th>Conversion Rate</th>
                        <th>CAC (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Organic Search</td>
                        <td>1,840</td>
                        <td className="is-pos">14.2%</td>
                        <td>$410</td>
                      </tr>
                      <tr>
                        <td>Paid Search</td>
                        <td>2,410</td>
                        <td>11.8%</td>
                        <td>$690</td>
                      </tr>
                      <tr>
                        <td>Display Retargeting</td>
                        <td>620</td>
                        <td className="is-neg">3.9%</td>
                        <td>$1,280</td>
                      </tr>
                    </tbody>
                  </table>
                </article>

                <article className="ds-preview-tile-card ds-preview-tile-wide">
                  <header>
                    <h3>Enterprise Retention &amp; Support SLA Breaches</h3>
                    <span>accounts.segment &bull; support.sla_breach_rate</span>
                  </header>
                  <table className="ds-preview-table">
                    <thead>
                      <tr>
                        <th>Customer Segment</th>
                        <th>Net Dollar Retention</th>
                        <th>P1 SLA Breach Rate</th>
                        <th>At-Risk ARR</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Strategic Enterprise</td>
                        <td className="is-pos">118.0%</td>
                        <td>2.1%</td>
                        <td>$320,000</td>
                      </tr>
                      <tr>
                        <td>Mid-Market</td>
                        <td>103.0%</td>
                        <td className="is-neg">8.4%</td>
                        <td>$790,000</td>
                      </tr>
                    </tbody>
                  </table>
                </article>
              </div>
            </div>
          ) : (
            <div className="ds-embed-stage">
              {embedLoading && (
                <div className="ds-embed-loading-overlay" aria-live="polite">
                  <span className="ext-spinner" />
                  <span>
                    Loading embedded Looker dashboard <code>#{activeDashboardId}</code>...
                  </span>
                </div>
              )}

              {embedError && (
                <div className="ds-embed-error-banner" role="alert">
                  <span>{embedError}</span>
                  <button
                    type="button"
                    className="ds-btn ds-btn-secondary ds-btn-xs"
                    onClick={() => setIsSettingsOpen(true)}
                  >
                    Configure Dashboard
                  </button>
                </div>
              )}

              <div
                ref={embedContainerRef}
                className="ds-embed-iframe-container"
                data-testid="looker-embed-container"
              />
            </div>
          )}
        </main>

        {/* Right-Hand Collapsible AI Dashboard Summarization Drawer */}
        <aside
          id="ds-standalone-insights-drawer"
          aria-label="AI Dashboard Summarization Drawer"
          className={`ds-standalone-drawer ${
            isDrawerOpen
              ? `is-open ${drawerWidth === 'wide' ? 'is-wide' : 'is-standard'}`
              : 'is-collapsed'
          }`}
        >
          {!isDrawerOpen && (
            <div className="ds-standalone-rail">
              <button
                type="button"
                className="ds-rail-expand-btn"
                aria-label="Expand AI Dashboard Insights Drawer"
                onClick={() => setIsDrawerOpen(true)}
                title="Expand AI Dashboard Insights Drawer"
              >
                <PanelRightOpen size={16} />
                <span className="ds-rail-status-dot" />
                <span className="ds-rail-label">
                  <Sparkles size={12} />
                  <span>Dashboard Insights</span>
                </span>
              </button>
            </div>
          )}

          <div
            className="ds-standalone-drawer-content"
            style={{ display: isDrawerOpen ? 'flex' : 'none' }}
          >
            {activeDashboardId ? (
              <ExtensionHostContext.Provider value={drawerHostContextValue}>
                <DashboardSummarization
                  key={activeDashboardId}
                  tileConfigOverride={workspaceConfig.tileConfig}
                />
              </ExtensionHostContext.Provider>
            ) : (
              <div className="ds-drawer-unconfigured">
                <Sparkles size={20} className="ds-accent-icon" />
                <h3>AI Insights Drawer</h3>
                <p>
                  Select a Looker dashboard in Workspace Settings to inspect its tiles and generate
                  an executive briefing.
                </p>
                <button
                  type="button"
                  className="ds-btn ds-btn-primary ds-btn-sm"
                  onClick={() => setIsSettingsOpen(true)}
                >
                  <Settings2 size={13} />
                  <span>Choose Dashboard</span>
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Standalone Workspace & Dashboard Settings Modal */}
      <StandaloneSettingsModal
        isOpen={isSettingsOpen}
        config={workspaceConfig}
        activeDashboardId={activeDashboardId}
        activeDashboardTitle={activeDashboardTitle}
        saving={savingSettings}
        onClose={() => setIsSettingsOpen(false)}
        onApplySession={applyDashboardSelection}
        onSaveDefault={handleSaveDefaultAndLoad}
      />
    </div>
  );
};
