import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  connectExtensionHost,
  LookerExtensionSDK,
  MountPoint,
  type ExtensionHostApi,
  type ExtensionSDK,
  type Filters,
  type LookerHostData,
  type TileHostData,
} from '@looker/extension-sdk';
import type { Looker40SDK } from '@looker/sdk';
import { serializeDashboardFilters } from '../utils/fetchDashboardDetails';

export function areTileHostDataEquivalent(prev: TileHostData, next: TileHostData): boolean {
  return (
    prev.dashboardId === next.dashboardId &&
    prev.elementId === next.elementId &&
    prev.dashboardRunState === next.dashboardRunState &&
    prev.isDashboardEditing === next.isDashboardEditing &&
    prev.isExploring === next.isExploring &&
    prev.lastRunStartTime === next.lastRunStartTime &&
    prev.lastRunEndTime === next.lastRunEndTime &&
    prev.lastRunSuccess === next.lastRunSuccess &&
    serializeDashboardFilters(prev.dashboardFilters) ===
      serializeDashboardFilters(next.dashboardFilters)
  );
}

export interface ExtensionHostContextValue {
  extensionSDK: ExtensionSDK;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  core40SDK: Looker40SDK | any;
  tileHostData: TileHostData;
  lookerHostData?: Readonly<LookerHostData>;
  isPreviewMode: boolean;
  isPreviewEditMode?: boolean;
  setIsPreviewEditMode?: (editing: boolean) => void;
  isStandaloneMount?: boolean;
  previewMountPoint?: 'tile' | 'standalone';
  setPreviewMountPoint?: (mount: 'tile' | 'standalone') => void;
  extensionRoute?: string;
  updateExtensionRoute?: (route: string) => void;
  connectionError: string | null;
}

export const ExtensionHostContext = createContext<ExtensionHostContextValue | undefined>(
  undefined
);

export function useExtensionHost(): ExtensionHostContextValue {
  const ctx = useContext(ExtensionHostContext);
  if (!ctx) {
    throw new Error('useExtensionHost must be used within LookerExtensionProvider');
  }
  return ctx;
}

interface PreviewArtifactEntry {
  key: string;
  value: string;
  version: number;
  content_type: string;
}

function buildLocalPreviewMocks(
  previewFilters: Filters,
  artifactStore: Map<string, PreviewArtifactEntry>,
  contextDataRef: React.MutableRefObject<unknown>,
  isPreviewEditMode: boolean,
  setIsPreviewEditMode: (editing: boolean) => void,
  previewMountPoint: 'tile' | 'standalone',
  setPreviewMountPoint: (mount: 'tile' | 'standalone') => void,
  extensionRoute: string,
  updateExtensionRoute: (route: string) => void
): Omit<ExtensionHostContextValue, 'connectionError'> {
  const storage = new Map<string, string>();
  const isStandalone = previewMountPoint === 'standalone';
  const lookerHostData: LookerHostData = {
    extensionId: 'dashboard-summarization::dashboard-summarization',
    lookerVersion: '26.20.0',
    hostUrl: 'https://looker.example.com',
    hostOrigin: 'https://looker.example.com',
    route: extensionRoute,
    mountPoint: isStandalone ? MountPoint.standalone : MountPoint.dashboardTile,
    extensionDashboardTileEnabled: true,
  };

  const proxyFetch = async (
    resource: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ) => {
    const resp = await fetch(resource, {
      method: init?.method || 'POST',
      headers: init?.headers,
      body: init?.body,
    });
    const text = await resp.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep raw text
    }
    return {
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      headers: {},
      body,
    };
  };

  const mockExtensionSDK = {
    lookerHostData,
    createSecretKeyTag: (keyName: string) => `{{${keyName}}}`,
    localStorageSetItem: async (name: string, value = '') => {
      storage.set(name, value);
      return true;
    },
    localStorageGetItem: async (name: string) => storage.get(name) ?? null,
    localStorageRemoveItem: async (name: string) => storage.delete(name),
    clipboardWrite: async (value: string) => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
    },
    openBrowserWindow: (url: string, target = '_blank') => {
      window.open(url, target, 'noopener,noreferrer');
    },
    clientRouteChanged: (route: string) => {
      updateExtensionRoute(route);
    },
    updateTitle: (title: string) => {
      if (typeof document !== 'undefined') {
        document.title = title;
      }
    },
    getContextData: () => contextDataRef.current,
    saveContextData: async (data: unknown) => {
      contextDataRef.current = data;
      return data;
    },
    refreshContextData: async () => contextDataRef.current,
    fetchProxy: proxyFetch,
    serverProxy: proxyFetch,
    oauth2Authenticate: async () => {
      throw new Error('OAuth requires running inside a Looker instance.');
    },
    oauth2ExchangeCodeForToken: async () => {
      throw new Error('OAuth requires running inside a Looker instance.');
    },
    rendered: () => undefined,
  } as unknown as ExtensionSDK;

  const sampleElements = [
    {
      title: 'Quarterly Revenue & Margin by Region',
      note_text: 'Net recognized revenue in USD excluding intercompany transfers.',
      query: {
        model: 'enterprise_sales',
        view: 'order_items',
        fields: [
          'orders.region',
          'order_items.total_revenue',
          'order_items.gross_margin_pct',
          'order_items.yoy_growth_pct',
        ],
        filters: { 'orders.created_date': '90 days' },
      },
      result_maker: {
        filterables: [
          {
            listen: [{ dashboard_filter_name: 'Timeframe', field: 'orders.created_date' }],
          },
        ],
      },
    },
    {
      title: 'Acquisition Pipeline & Conversion by Channel',
      note_text:
        'Tracks qualified pipeline to closed-won conversion across paid and organic channels.',
      query: {
        model: 'enterprise_sales',
        view: 'marketing_attribution',
        fields: [
          'attribution.channel',
          'attribution.qualified_leads',
          'attribution.conversion_rate',
          'attribution.cac_usd',
        ],
        filters: { 'attribution.event_date': '90 days' },
      },
      result_maker: { filterables: [] },
    },
    {
      title: 'Enterprise Retention & Support SLA Breaches',
      note_text: 'Highlights net dollar retention and P1 ticket SLA compliance by segment.',
      query: {
        model: 'enterprise_sales',
        view: 'account_health',
        fields: [
          'accounts.segment',
          'accounts.net_dollar_retention',
          'support.sla_breach_rate',
          'accounts.at_risk_arr',
        ],
        filters: {},
      },
      result_maker: { filterables: [] },
    },
  ];

  const sampleDatasets: Record<string, Array<Record<string, unknown>>> = {
    order_items: [
      {
        'orders.region': 'North America',
        'order_items.total_revenue': 4820000,
        'order_items.gross_margin_pct': 0.64,
        'order_items.yoy_growth_pct': 0.21,
      },
      {
        'orders.region': 'EMEA',
        'order_items.total_revenue': 2390000,
        'order_items.gross_margin_pct': 0.58,
        'order_items.yoy_growth_pct': -0.04,
      },
      {
        'orders.region': 'APAC',
        'order_items.total_revenue': 1740000,
        'order_items.gross_margin_pct': 0.61,
        'order_items.yoy_growth_pct': 0.16,
      },
    ],
    marketing_attribution: [
      {
        'attribution.channel': 'Organic Search',
        'attribution.qualified_leads': 1840,
        'attribution.conversion_rate': 0.142,
        'attribution.cac_usd': 410,
      },
      {
        'attribution.channel': 'Paid Search',
        'attribution.qualified_leads': 2410,
        'attribution.conversion_rate': 0.118,
        'attribution.cac_usd': 690,
      },
      {
        'attribution.channel': 'Display Retargeting',
        'attribution.qualified_leads': 620,
        'attribution.conversion_rate': 0.039,
        'attribution.cac_usd': 1280,
      },
    ],
    account_health: [
      {
        'accounts.segment': 'Strategic Enterprise',
        'accounts.net_dollar_retention': 1.18,
        'support.sla_breach_rate': 0.021,
        'accounts.at_risk_arr': 320000,
      },
      {
        'accounts.segment': 'Mid-Market',
        'accounts.net_dollar_retention': 1.03,
        'support.sla_breach_rate': 0.084,
        'accounts.at_risk_arr': 790000,
      },
    ],
  };

  const mockCore40SDK = {
    ok: async <T,>(promise: Promise<T> | T) => promise,
    artifact: async ({ namespace, key }: { namespace: string; key: string }) => {
      const compositeKey = `${namespace}:${key}`;
      const found = artifactStore.get(compositeKey);
      return found ? [found] : [];
    },
    update_artifacts: async (
      namespace: string,
      body: Array<{ key: string; value: string; content_type?: string; version?: number }>
    ) => {
      const saved: PreviewArtifactEntry[] = [];
      for (const item of body) {
        const compositeKey = `${namespace}:${item.key}`;
        const prev = artifactStore.get(compositeKey);
        const nextEntry: PreviewArtifactEntry = {
          key: item.key,
          value: item.value,
          version: (prev?.version ?? 0) + 1,
          content_type: item.content_type || 'application/json',
        };
        artifactStore.set(compositeKey, nextEntry);
        saved.push(nextEntry);
      }
      return saved;
    },
    dashboard: async () => ({
      description:
        'Executive Business Pulse tracking regional net revenue, marketing efficiency, and customer retention health.',
      dashboard_elements: sampleElements,
    }),
    dashboard_dashboard_elements: async () => sampleElements,
    run_inline_query: async ({ body }: { body: { view: string } }) =>
      sampleDatasets[body.view] || [],
  };

  return {
    extensionSDK: mockExtensionSDK,
    core40SDK: mockCore40SDK,
    tileHostData: isStandalone
      ? {}
      : {
          dashboardId: 'preview_exec_pulse',
          elementId: 'preview_tile_1',
          isDashboardEditing: isPreviewEditMode,
          dashboardFilters: previewFilters,
        },
    lookerHostData,
    isPreviewMode: true,
    isPreviewEditMode,
    setIsPreviewEditMode,
    isStandaloneMount: isStandalone,
    previewMountPoint,
    setPreviewMountPoint,
    extensionRoute,
    updateExtensionRoute,
  };
}

export const LookerExtensionProvider: React.FC<{
  children: React.ReactNode;
  overrideValue?: ExtensionHostContextValue;
}> = ({ children, overrideValue }) => {
  const isStandalonePreview = useMemo(() => {
    if (overrideValue) return false;
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return window.self === window.top && params.has('preview');
  }, [overrideValue]);

  const initialPreviewEdit = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('edit') === '1' || params.get('edit') === 'true';
  }, []);

  const initialPreviewMount = useMemo<'tile' | 'standalone'>(() => {
    if (typeof window === 'undefined') return 'tile';
    const params = new URLSearchParams(window.location.search);
    return params.get('mount') === 'standalone' ? 'standalone' : 'tile';
  }, []);

  const initialPreviewRoute = useMemo(() => {
    if (typeof window === 'undefined') return '/';
    return `${window.location.pathname}${window.location.search}`;
  }, []);

  const [hostApi, setHostApi] = useState<ExtensionHostApi | null>(null);
  const [core40SDK, setCore40SDK] = useState<Looker40SDK | null>(null);
  const [tileHostData, setTileHostData] = useState<TileHostData>({});
  const [extensionRoute, setExtensionRoute] = useState<string>(initialPreviewRoute);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isPreviewEditMode, setIsPreviewEditMode] = useState<boolean>(initialPreviewEdit);
  const [previewMountPoint, setPreviewMountPoint] = useState<'tile' | 'standalone'>(
    initialPreviewMount
  );
  const previewArtifactStoreRef = useRef<Map<string, PreviewArtifactEntry>>(new Map());
  const previewContextDataRef = useRef<unknown>(undefined);
  const [previewFilters] = useState<Filters>({
    Timeframe: 'Last 90 Days',
    Segment: 'All Segments',
  });

  const updateExtensionRoute = useCallback(
    (nextRoute: string) => {
      setExtensionRoute(nextRoute);
      if (hostApi && typeof hostApi.clientRouteChanged === 'function') {
        try {
          hostApi.clientRouteChanged(nextRoute);
        } catch {
          // Non-fatal if navigation entitlement is absent
        }
      }
    },
    [hostApi]
  );

  useEffect(() => {
    if (overrideValue || isStandalonePreview) return;

    let cancelled = false;
    connectExtensionHost({
      chattyTimeout: 300000,
      setInitialRoute: (route) => {
        if (!cancelled && route) {
          setExtensionRoute(route);
        }
      },
      hostChangedRoute: (route) => {
        if (!cancelled && route) {
          setExtensionRoute(route);
        }
      },
      tileHostDataChangedCallback: (updatedData) => {
        if (!cancelled) {
          setTileHostData((prev) => {
            const merged: TileHostData = { ...prev, ...updatedData };
            return areTileHostDataEquivalent(prev, merged) ? prev : merged;
          });
        }
      },
    })
      .then((connectedHost) => {
        if (cancelled) return;
        const sdk = LookerExtensionSDK.createClient(connectedHost);
        setHostApi(connectedHost);
        setCore40SDK(sdk);
        if (connectedHost.lookerHostData?.route) {
          setExtensionRoute(connectedHost.lookerHostData.route);
        }
        if (connectedHost.tileSDK?.tileHostData) {
          const initialTileData = connectedHost.tileSDK.tileHostData;
          setTileHostData((prev) => {
            const merged: TileHostData = { ...prev, ...initialTileData };
            return areTileHostDataEquivalent(prev, merged) ? prev : merged;
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setConnectionError(
            err instanceof Error
              ? err.message
              : 'Unable to connect to the Looker Extension Host.'
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [overrideValue, isStandalonePreview]);

  const previewContext = useMemo(() => {
    if (!isStandalonePreview) return null;
    return {
      ...buildLocalPreviewMocks(
        previewFilters,
        previewArtifactStoreRef.current,
        previewContextDataRef,
        isPreviewEditMode,
        setIsPreviewEditMode,
        previewMountPoint,
        setPreviewMountPoint,
        extensionRoute,
        updateExtensionRoute
      ),
      connectionError: null,
    };
  }, [
    extensionRoute,
    isPreviewEditMode,
    isStandalonePreview,
    previewFilters,
    previewMountPoint,
    updateExtensionRoute,
  ]);

  if (overrideValue) {
    return (
      <ExtensionHostContext.Provider value={overrideValue}>
        {children}
      </ExtensionHostContext.Provider>
    );
  }

  if (previewContext) {
    return (
      <ExtensionHostContext.Provider value={previewContext}>
        {children}
      </ExtensionHostContext.Provider>
    );
  }

  if (connectionError) {
    return (
      <div className="ext-shell-status" role="alert">
        <div className="ext-shell-card">
          <h2>Looker Host Connection Required</h2>
          <p>{connectionError}</p>
          <p className="ext-shell-hint">
            Open this extension inside a Looker Dashboard Tile, or append{' '}
            <code>?preview=1</code> locally to inspect the UI in standalone preview mode.
          </p>
        </div>
      </div>
    );
  }

  if (!hostApi || !core40SDK) {
    return (
      <div className="ext-shell-status" aria-busy="true">
        <div className="ext-spinner" />
        <span>Connecting to Looker Extension Host...</span>
      </div>
    );
  }

  const hostMountPoint = hostApi.lookerHostData?.mountPoint;
  const isStandaloneMount =
    hostMountPoint === MountPoint.standalone ||
    (!tileHostData.dashboardId &&
      hostMountPoint !== MountPoint.dashboardTile &&
      hostMountPoint !== MountPoint.dashboardTilePopup &&
      hostMountPoint !== MountPoint.dashboardVisualization);

  return (
    <ExtensionHostContext.Provider
      value={{
        extensionSDK: hostApi,
        core40SDK,
        tileHostData,
        lookerHostData: hostApi.lookerHostData,
        isPreviewMode: false,
        isStandaloneMount,
        extensionRoute,
        updateExtensionRoute,
        connectionError: null,
      }}
    >
      {children}
    </ExtensionHostContext.Provider>
  );
};
