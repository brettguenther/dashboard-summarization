import type { ExtensionSDK } from '@looker/extension-sdk';
import type { TileConfiguration } from '../types';
import { PRESET_PROMPTS } from './presets';

export const ARTIFACT_NAMESPACE = 'dashboard_summarization_config';
export const MAX_PROMPT_LENGTH = 4000;

export const DEFAULT_TILE_CONFIG: TileConfiguration = {
  autoRun: false,
  autoRefreshOnFilterChange: false,
  allowPromptOverride: true,
  pipelineMode: 'single_pass',
  defaultPresetId: PRESET_PROMPTS[0].id,
  defaultPrompt: PRESET_PROMPTS[0].prompt,
  showNextSteps: true,
  showFollowUpQuestions: true,
};

const VALID_PRESET_IDS = new Set(PRESET_PROMPTS.map((p) => p.id));

function sanitizeKeySegment(value: string | undefined | null, fallback: string): string {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  return cleaned || fallback;
}

export function buildTileConfigKey(
  dashboardId?: string,
  elementId?: string | null
): string {
  const safeDash = sanitizeKeySegment(dashboardId, 'unknown');
  const safeElem = sanitizeKeySegment(elementId, 'default');
  return `tile_${safeDash}_${safeElem}`;
}

export function sanitizeTileConfig(raw: unknown): TileConfiguration {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TILE_CONFIG };
  }
  const obj = raw as Record<string, unknown>;
  const rawPrompt =
    typeof obj.defaultPrompt === 'string'
      ? obj.defaultPrompt.trim().slice(0, MAX_PROMPT_LENGTH)
      : '';
  const defaultPrompt = rawPrompt || DEFAULT_TILE_CONFIG.defaultPrompt;

  let defaultPresetId: string | null = null;
  if (typeof obj.defaultPresetId === 'string' && VALID_PRESET_IDS.has(obj.defaultPresetId)) {
    defaultPresetId = obj.defaultPresetId;
  } else if (obj.defaultPresetId === null) {
    defaultPresetId = null;
  } else {
    const matchedPreset = PRESET_PROMPTS.find((p) => p.prompt === defaultPrompt);
    defaultPresetId = matchedPreset ? matchedPreset.id : null;
  }

  const autoRun = typeof obj.autoRun === 'boolean' ? obj.autoRun : DEFAULT_TILE_CONFIG.autoRun;
  const pipelineMode =
    obj.pipelineMode === 'parallel' ? ('parallel' as const) : ('single_pass' as const);

  return {
    autoRun,
    autoRefreshOnFilterChange:
      typeof obj.autoRefreshOnFilterChange === 'boolean'
        ? obj.autoRefreshOnFilterChange
        : DEFAULT_TILE_CONFIG.autoRefreshOnFilterChange,
    allowPromptOverride:
      typeof obj.allowPromptOverride === 'boolean'
        ? obj.allowPromptOverride
        : DEFAULT_TILE_CONFIG.allowPromptOverride,
    pipelineMode,
    defaultPresetId,
    defaultPrompt,
    showNextSteps:
      typeof obj.showNextSteps === 'boolean'
        ? obj.showNextSteps
        : DEFAULT_TILE_CONFIG.showNextSteps,
    showFollowUpQuestions:
      typeof obj.showFollowUpQuestions === 'boolean'
        ? obj.showFollowUpQuestions
        : DEFAULT_TILE_CONFIG.showFollowUpQuestions,
  };
}

interface ArtifactRecordLike {
  key?: string;
  value?: string;
  version?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ArtifactCapableSDK = Record<string, any> | null | undefined;

async function readArtifactRecord(
  core40SDK: ArtifactCapableSDK,
  key: string
): Promise<ArtifactRecordLike | null> {
  if (!core40SDK || typeof core40SDK.artifact !== 'function') {
    return null;
  }
  const rawResp = core40SDK.artifact({ namespace: ARTIFACT_NAMESPACE, key });
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

function tryParseConfigJson(rawJson: string | null | undefined): TileConfiguration | null {
  if (typeof rawJson !== 'string' || !rawJson.trim()) {
    return null;
  }
  try {
    return sanitizeTileConfig(JSON.parse(rawJson));
  } catch {
    return null;
  }
}

export async function loadTileConfig(
  core40SDK: ArtifactCapableSDK,
  extensionSDK: Pick<ExtensionSDK, 'localStorageGetItem'> | undefined,
  dashboardId?: string,
  elementId?: string | null,
  isPreviewMode = false
): Promise<TileConfiguration> {
  if (!dashboardId || dashboardId === 'undefined') {
    return { ...DEFAULT_TILE_CONFIG };
  }

  const primaryKey = buildTileConfigKey(dashboardId, elementId);
  const fallbackKey = buildTileConfigKey(dashboardId, 'default');
  const candidateKeys = primaryKey === fallbackKey ? [primaryKey] : [primaryKey, fallbackKey];

  if (!isPreviewMode && core40SDK && typeof core40SDK.artifact === 'function') {
    try {
      for (const key of candidateKeys) {
        const record = await readArtifactRecord(core40SDK, key);
        const parsed = tryParseConfigJson(record?.value);
        if (parsed) {
          return parsed;
        }
      }
      return { ...DEFAULT_TILE_CONFIG };
    } catch {
      // Fall back to extension localStorage if artifact entitlements are not yet active
    }
  } else if (isPreviewMode && core40SDK && typeof core40SDK.artifact === 'function') {
    try {
      for (const key of candidateKeys) {
        const record = await readArtifactRecord(core40SDK, key);
        const parsed = tryParseConfigJson(record?.value);
        if (parsed) {
          return parsed;
        }
      }
    } catch {
      // Fall through to localStorage
    }
  }

  if (typeof extensionSDK?.localStorageGetItem === 'function') {
    for (const key of candidateKeys) {
      try {
        const localVal = await extensionSDK.localStorageGetItem(key);
        const parsed = tryParseConfigJson(localVal);
        if (parsed) {
          return parsed;
        }
      } catch {
        // Ignore storage read failure
      }
    }
  }

  if (isPreviewMode && typeof window !== 'undefined' && window.localStorage) {
    for (const key of candidateKeys) {
      try {
        const browserVal = window.localStorage.getItem(`${ARTIFACT_NAMESPACE}:${key}`);
        const parsed = tryParseConfigJson(browserVal);
        if (parsed) {
          return parsed;
        }
      } catch {
        // Ignore browser storage access error
      }
    }
  }

  return { ...DEFAULT_TILE_CONFIG };
}

export interface SaveTileConfigResult {
  config: TileConfiguration;
  persistedToArtifactStore: boolean;
}

export async function saveTileConfig(
  core40SDK: ArtifactCapableSDK,
  extensionSDK: Pick<ExtensionSDK, 'localStorageSetItem'> | undefined,
  dashboardId: string | undefined,
  elementId: string | null | undefined,
  config: TileConfiguration,
  isPreviewMode = false
): Promise<SaveTileConfigResult> {
  const sanitized = sanitizeTileConfig(config);
  const serialized = JSON.stringify(sanitized);
  const primaryKey = buildTileConfigKey(dashboardId, elementId);

  let persistedToArtifactStore = false;

  if (
    core40SDK &&
    typeof core40SDK.artifact === 'function' &&
    typeof core40SDK.update_artifacts === 'function'
  ) {
    try {
      const existing = await readArtifactRecord(core40SDK, primaryKey);
      const payload = [
        {
          key: primaryKey,
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

  if (typeof extensionSDK?.localStorageSetItem === 'function') {
    try {
      await extensionSDK.localStorageSetItem(primaryKey, serialized);
    } catch {
      // Ignore fallback storage failure
    }
  }

  if (isPreviewMode && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(`${ARTIFACT_NAMESPACE}:${primaryKey}`, serialized);
    } catch {
      // Ignore browser localStorage error
    }
  }

  return {
    config: sanitized,
    persistedToArtifactStore,
  };
}
