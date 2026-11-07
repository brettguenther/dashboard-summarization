import type { ExtensionSDK, Filters } from '@looker/extension-sdk';
import type {
  DrawerWidthMode,
  LookerDashboardOption,
  StandaloneWorkspaceConfig,
} from '../types';
import {
  ARTIFACT_NAMESPACE,
  DEFAULT_TILE_CONFIG,
  sanitizeTileConfig,
} from './tileConfigStorage';

export const STANDALONE_CONFIG_KEY = 'standalone_workspace_config';

const INTERNAL_QUERY_PARAMS = new Set([
  'sdk',
  'embed_domain',
  'dashboard_id',
  'dashboardid',
  'sandboxed_host',
  '_theme',
  'preview',
  'mount',
  'edit',
]);

export const DEFAULT_STANDALONE_CONFIG: StandaloneWorkspaceConfig = {
  defaultDashboardId: '',
  defaultDashboardTitle: '',
  defaultDrawerOpen: true,
  drawerWidth: 'standard',
  tileConfig: { ...DEFAULT_TILE_CONFIG },
};

/**
 * Extracts filter parameters and dashboard ID from a URL, route path, or raw ID string.
 * Modeled after lkrdev/dashboard-tabs urlToRecord + AppContext route parsing.
 */
export function parseDashboardInput(rawInput: string | undefined | null): {
  dashboardId: string;
  filters: Filters;
} {
  const trimmed = String(rawInput ?? '').trim();
  if (!trimmed) {
    return { dashboardId: '', filters: {} };
  }

  let pathname = trimmed;
  let search = '';

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      pathname = parsed.pathname;
      search = parsed.search;
    } catch {
      // Fall back to string splitting
    }
  } else if (trimmed.includes('?')) {
    const qIdx = trimmed.indexOf('?');
    pathname = trimmed.slice(0, qIdx);
    search = trimmed.slice(qIdx);
  }

  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const filters: Filters = {};
  let paramDashboardId = '';

  params.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'dashboard_id' || lower === 'dashboardid') {
      if (value.trim()) {
        paramDashboardId = value.trim();
      }
      return;
    }
    if (INTERNAL_QUERY_PARAMS.has(lower)) {
      return;
    }
    if (value.trim().length > 0) {
      filters[key] = value;
    }
  });

  // Check for /dashboards/<id> or /embed/dashboards/<id> in pathname
  let pathDashboardId = '';
  const cleanPath = pathname.replace(/^\/+|\/+$/g, '');
  if (cleanPath) {
    const dashMatch = cleanPath.match(/(?:^|\/)dashboards\/([^/?#]+)/i);
    if (dashMatch && dashMatch[1]) {
      pathDashboardId = decodeURIComponent(dashMatch[1]);
    } else if (!cleanPath.includes('/') && !cleanPath.startsWith('?')) {
      pathDashboardId = decodeURIComponent(cleanPath);
    }
  }

  const dashboardId = pathDashboardId || paramDashboardId;
  return { dashboardId, filters };
}

/**
 * Extracts filters from an embedded Looker page:changed absoluteUrl event,
 * filtering out Looker embed internal query parameters.
 */
export function extractFiltersFromEmbedUrl(url: string | undefined | null): Filters {
  if (!url) return {};
  try {
    const parsed = new URL(url, 'https://looker.example.com');
    const filters: Filters = {};
    parsed.searchParams.forEach((value, key) => {
      if (!INTERNAL_QUERY_PARAMS.has(key.toLowerCase()) && value.trim().length > 0) {
        filters[key] = value;
      }
    });
    return filters;
  } catch {
    return {};
  }
}

/**
 * Builds the extension route string for clientRouteChanged so the active dashboard
 * and filters are reflected in the Looker URL bar for bookmarking and sharing.
 */
export function buildStandaloneRoute(dashboardId: string, filters?: Filters): string {
  const cleanId = dashboardId.trim();
  if (!cleanId) {
    return '/';
  }
  const params = new URLSearchParams();
  params.set('dashboard_id', cleanId);
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (
        !INTERNAL_QUERY_PARAMS.has(key.toLowerCase()) &&
        val !== undefined &&
        val !== null &&
        String(val).trim() !== ''
      ) {
        params.set(key, String(val));
      }
    }
  }
  return `/dashboards/${encodeURIComponent(cleanId)}?${params.toString()}`;
}

export function sanitizeStandaloneConfig(raw: unknown): StandaloneWorkspaceConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_STANDALONE_CONFIG,
      tileConfig: { ...DEFAULT_TILE_CONFIG },
    };
  }
  const obj = raw as Record<string, unknown>;
  const parsedDash = parseDashboardInput(
    typeof obj.defaultDashboardId === 'string' ? obj.defaultDashboardId : ''
  );
  const defaultDashboardTitle =
    typeof obj.defaultDashboardTitle === 'string'
      ? obj.defaultDashboardTitle.trim().slice(0, 200)
      : '';
  const defaultDrawerOpen =
    typeof obj.defaultDrawerOpen === 'boolean'
      ? obj.defaultDrawerOpen
      : DEFAULT_STANDALONE_CONFIG.defaultDrawerOpen;
  const drawerWidth: DrawerWidthMode = obj.drawerWidth === 'wide' ? 'wide' : 'standard';
  const tileConfig = sanitizeTileConfig(obj.tileConfig ?? obj);

  return {
    defaultDashboardId: parsedDash.dashboardId,
    defaultDashboardTitle,
    defaultDrawerOpen,
    drawerWidth,
    tileConfig,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ArtifactCapableSDK = Record<string, any> | null | undefined;

interface ArtifactRecordLike {
  key?: string;
  value?: string;
  version?: number;
}

async function readStandaloneArtifact(
  core40SDK: ArtifactCapableSDK
): Promise<ArtifactRecordLike | null> {
  if (!core40SDK || typeof core40SDK.artifact !== 'function') {
    return null;
  }
  const rawResp = core40SDK.artifact({
    namespace: ARTIFACT_NAMESPACE,
    key: STANDALONE_CONFIG_KEY,
  });
  const unwrapped =
    typeof core40SDK.ok === 'function' ? await core40SDK.ok(rawResp) : await rawResp;
  if (Array.isArray(unwrapped) && unwrapped.length > 0) {
    return unwrapped[0] as ArtifactRecordLike;
  }
  if (unwrapped && typeof unwrapped === 'object' && 'value' in unwrapped) {
    return unwrapped as ArtifactRecordLike;
  }
  return null;
}

function tryParseStandaloneJson(
  rawJson: string | null | undefined
): StandaloneWorkspaceConfig | null {
  if (typeof rawJson !== 'string' || !rawJson.trim()) {
    return null;
  }
  try {
    return sanitizeStandaloneConfig(JSON.parse(rawJson));
  } catch {
    return null;
  }
}

export async function loadStandaloneConfig(
  core40SDK: ArtifactCapableSDK,
  extensionSDK:
    | Pick<ExtensionSDK, 'localStorageGetItem' | 'getContextData'>
    | undefined,
  isPreviewMode = false
): Promise<StandaloneWorkspaceConfig> {
  // 1. Check CustomerArtifactStore first
  if (core40SDK && typeof core40SDK.artifact === 'function') {
    try {
      const record = await readStandaloneArtifact(core40SDK);
      const parsed = tryParseStandaloneJson(record?.value);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Fall back to contextData / localStorage
    }
  }

  // 2. Check Looker Extension ContextData (lkrdev/dashboard-tabs pattern)
  if (typeof extensionSDK?.getContextData === 'function') {
    try {
      const ctxData = extensionSDK.getContextData();
      if (ctxData && typeof ctxData === 'object') {
        const parsed = sanitizeStandaloneConfig(ctxData);
        if (parsed.defaultDashboardId) {
          return parsed;
        }
      }
    } catch {
      // Ignore context data error
    }
  }

  // 3. Check extensionSDK.localStorageGetItem
  if (typeof extensionSDK?.localStorageGetItem === 'function') {
    try {
      const localVal = await extensionSDK.localStorageGetItem(STANDALONE_CONFIG_KEY);
      const parsed = tryParseStandaloneJson(localVal);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Ignore storage read error
    }
  }

  // 4. Browser localStorage in preview mode
  if (isPreviewMode && typeof window !== 'undefined' && window.localStorage) {
    try {
      const browserVal = window.localStorage.getItem(
        `${ARTIFACT_NAMESPACE}:${STANDALONE_CONFIG_KEY}`
      );
      const parsed = tryParseStandaloneJson(browserVal);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Ignore browser storage error
    }
  }

  return {
    ...DEFAULT_STANDALONE_CONFIG,
    tileConfig: { ...DEFAULT_TILE_CONFIG },
  };
}

export interface SaveStandaloneConfigResult {
  config: StandaloneWorkspaceConfig;
  persistedToArtifactStore: boolean;
}

export async function saveStandaloneConfig(
  core40SDK: ArtifactCapableSDK,
  extensionSDK:
    | Pick<
        ExtensionSDK,
        'localStorageSetItem' | 'saveContextData' | 'refreshContextData'
      >
    | undefined,
  config: StandaloneWorkspaceConfig,
  isPreviewMode = false
): Promise<SaveStandaloneConfigResult> {
  const sanitized = sanitizeStandaloneConfig(config);
  const serialized = JSON.stringify(sanitized);
  let persistedToArtifactStore = false;

  if (
    core40SDK &&
    typeof core40SDK.artifact === 'function' &&
    typeof core40SDK.update_artifacts === 'function'
  ) {
    try {
      const existing = await readStandaloneArtifact(core40SDK);
      const payload = [
        {
          key: STANDALONE_CONFIG_KEY,
          value: serialized,
          content_type: 'application/json',
          ...(typeof existing?.version === 'number' ? { version: existing.version } : {}),
        },
      ];
      const updateResp = core40SDK.update_artifacts(ARTIFACT_NAMESPACE, payload);
      if (typeof core40SDK.ok === 'function') {
        await core40SDK.ok(updateResp);
      } else {
        await updateResp;
      }
      persistedToArtifactStore = true;
    } catch {
      persistedToArtifactStore = false;
    }
  }

  if (typeof extensionSDK?.saveContextData === 'function') {
    try {
      await extensionSDK.saveContextData(sanitized);
      if (typeof extensionSDK.refreshContextData === 'function') {
        await extensionSDK.refreshContextData();
      }
    } catch {
      // Non-fatal if user lacks saveContextData permissions
    }
  }

  if (typeof extensionSDK?.localStorageSetItem === 'function') {
    try {
      await extensionSDK.localStorageSetItem(STANDALONE_CONFIG_KEY, serialized);
    } catch {
      // Ignore fallback storage failure
    }
  }

  if (isPreviewMode && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(
        `${ARTIFACT_NAMESPACE}:${STANDALONE_CONFIG_KEY}`,
        serialized
      );
    } catch {
      // Ignore browser localStorage error
    }
  }

  return {
    config: sanitized,
    persistedToArtifactStore,
  };
}

export async function fetchAvailableDashboards(
  core40SDK: ArtifactCapableSDK,
  searchQuery = '',
  isPreviewMode = false
): Promise<LookerDashboardOption[]> {
  if (isPreviewMode) {
    const sampleDashboards: LookerDashboardOption[] = [
      {
        id: 'preview_exec_pulse',
        title: 'Executive Business Pulse (Preview)',
        folderName: 'Shared',
      },
      {
        id: '238',
        title: 'Apex National Bank — Executive Command Center',
        folderName: 'Shared',
      },
      {
        id: '235',
        title: 'Sandbox Look Orders Dashboard Summarization',
        folderName: 'Shared',
      },
    ];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sampleDashboards;
    return sampleDashboards.filter(
      (d) => d.title.toLowerCase().includes(q) || d.id.toLowerCase().includes(q)
    );
  }

  if (!core40SDK) return [];

  try {
    const trimmed = searchQuery.trim();
    if (typeof core40SDK.search_dashboards === 'function') {
      const resp = core40SDK.search_dashboards({
        limit: 50,
        title: trimmed ? `%${trimmed.replace(/\s+/g, '%')}%` : undefined,
        sorts: 'title',
      });
      const items = typeof core40SDK.ok === 'function' ? await core40SDK.ok(resp) : await resp;
      if (Array.isArray(items)) {
        return items
          .filter((item) => item && item.id && item.title)
          .map((item) => ({
            id: String(item.id),
            title: String(item.title),
            folderName: item.folder?.name ? String(item.folder.name) : undefined,
          }));
      }
    }

    if (typeof core40SDK.all_dashboards === 'function') {
      const resp = core40SDK.all_dashboards('id,title,folder');
      const items = typeof core40SDK.ok === 'function' ? await core40SDK.ok(resp) : await resp;
      if (Array.isArray(items)) {
        const mapped = items
          .filter((item) => item && item.id && item.title)
          .map((item) => ({
            id: String(item.id),
            title: String(item.title),
            folderName: item.folder?.name ? String(item.folder.name) : undefined,
          }))
          .sort((a, b) => a.title.localeCompare(b.title));

        if (!trimmed) return mapped.slice(0, 50);
        const lower = trimmed.toLowerCase();
        return mapped
          .filter(
            (d) => d.title.toLowerCase().includes(lower) || d.id.toLowerCase().includes(lower)
          )
          .slice(0, 50);
      }
    }
  } catch (err) {
    console.warn('Unable to list dashboards via Looker SDK:', err);
  }

  return [];
}
