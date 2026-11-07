import React, { useEffect, useState } from 'react';
import {
  Check,
  Columns2,
  Folder,
  Layers,
  LayoutDashboard,
  Maximize2,
  Play,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type { Filters } from '@looker/extension-sdk';
import { useExtensionHost } from '../contexts/ExtensionHostContext';
import type {
  DrawerWidthMode,
  LookerDashboardOption,
  StandaloneWorkspaceConfig,
} from '../types';
import { PRESET_PROMPTS, type PresetPrompt } from '../utils/presets';
import {
  DEFAULT_STANDALONE_CONFIG,
  fetchAvailableDashboards,
  parseDashboardInput,
} from '../utils/standaloneConfigStorage';
import { DEFAULT_TILE_CONFIG, MAX_PROMPT_LENGTH } from '../utils/tileConfigStorage';

export interface StandaloneSettingsModalProps {
  isOpen: boolean;
  config: StandaloneWorkspaceConfig;
  activeDashboardId: string;
  activeDashboardTitle: string;
  saving: boolean;
  onClose: () => void;
  onApplySession: (
    dashboardId: string,
    dashboardTitle: string,
    extractedFilters: Filters,
    nextConfig: StandaloneWorkspaceConfig
  ) => void;
  onSaveDefault: (
    dashboardId: string,
    dashboardTitle: string,
    extractedFilters: Filters,
    nextConfig: StandaloneWorkspaceConfig
  ) => Promise<void> | void;
}

export const StandaloneSettingsModal: React.FC<StandaloneSettingsModalProps> = ({
  isOpen,
  config,
  activeDashboardId,
  activeDashboardTitle,
  saving,
  onClose,
  onApplySession,
  onSaveDefault,
}) => {
  const { core40SDK, isPreviewMode } = useExtensionHost();

  const [dashboardInput, setDashboardInput] = useState<string>(
    activeDashboardId || config.defaultDashboardId || ''
  );
  const [selectedTitle, setSelectedTitle] = useState<string>(
    activeDashboardTitle || config.defaultDashboardTitle || ''
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [dashboards, setDashboards] = useState<LookerDashboardOption[]>([]);
  const [loadingDashboards, setLoadingDashboards] = useState<boolean>(false);
  const [draft, setDraft] = useState<StandaloneWorkspaceConfig>(config);

  const serializedConfig = JSON.stringify(config);

  useEffect(() => {
    if (!isOpen) return;
    const parsedConfig = JSON.parse(serializedConfig) as StandaloneWorkspaceConfig;
    setDraft(parsedConfig);
    setDashboardInput(activeDashboardId || parsedConfig.defaultDashboardId || '');
    setSelectedTitle(activeDashboardTitle || parsedConfig.defaultDashboardTitle || '');
  }, [isOpen, serializedConfig, activeDashboardId, activeDashboardTitle]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoadingDashboards(true);
    fetchAvailableDashboards(core40SDK, debouncedQuery, isPreviewMode)
      .then((results) => {
        if (!cancelled) {
          setDashboards(results);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDashboards(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [core40SDK, debouncedQuery, isOpen, isPreviewMode]);

  if (!isOpen) return null;

  const parsedInput = parseDashboardInput(dashboardInput);
  const resolvedDashboardId = parsedInput.dashboardId;
  const extractedFilterCount = Object.keys(parsedInput.filters).length;

  const handleSelectDashboardOption = (option: LookerDashboardOption) => {
    setDashboardInput(option.id);
    setSelectedTitle(option.title);
    setDraft((prev) => ({
      ...prev,
      defaultDashboardId: option.id,
      defaultDashboardTitle: option.title,
    }));
  };

  const handlePresetClick = (preset: PresetPrompt) => {
    setDraft((prev) => ({
      ...prev,
      tileConfig: {
        ...prev.tileConfig,
        defaultPresetId: preset.id,
        defaultPrompt: preset.prompt,
      },
    }));
  };

  const handleResetDefaults = () => {
    setDraft({
      ...DEFAULT_STANDALONE_CONFIG,
      defaultDashboardId: resolvedDashboardId,
      defaultDashboardTitle: selectedTitle,
      tileConfig: { ...DEFAULT_TILE_CONFIG },
    });
  };

  const buildNextConfig = (): StandaloneWorkspaceConfig => ({
    ...draft,
    defaultDashboardId: resolvedDashboardId,
    defaultDashboardTitle: selectedTitle,
  });

  const handleLoadSessionOnly = () => {
    if (!resolvedDashboardId) return;
    onApplySession(
      resolvedDashboardId,
      selectedTitle,
      parsedInput.filters,
      buildNextConfig()
    );
  };

  const handleSaveAndLoad = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedDashboardId) return;
    void onSaveDefault(
      resolvedDashboardId,
      selectedTitle,
      parsedInput.filters,
      buildNextConfig()
    );
  };

  const setDrawerWidth = (width: DrawerWidthMode) => {
    setDraft((prev) => ({ ...prev, drawerWidth: width }));
  };

  return (
    <>
      <div
        className="ds-backdrop"
        onClick={() => {
          if (activeDashboardId) onClose();
        }}
      />
      <div
        className="ds-standalone-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Standalone Workspace & Dashboard Settings"
      >
        <div className="ds-standalone-modal-header">
          <div className="ds-standalone-modal-title">
            <Settings2 size={17} className="ds-accent-icon" />
            <div>
              <h2>Standalone Workspace &amp; Dashboard Settings</h2>
              <p>
                Select a Looker dashboard to embed on the main canvas and configure the right-hand
                AI Insights drawer.
              </p>
            </div>
          </div>
          {activeDashboardId && (
            <button
              type="button"
              className="ds-icon-btn"
              aria-label="Close settings"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <form className="ds-standalone-modal-body" onSubmit={handleSaveAndLoad}>
          <div className="ds-config-grid">
            {/* Left Column: Dashboard Selection & Drawer Layout */}
            <div className="ds-config-col">
              <section className="ds-config-section">
                <h3 className="ds-config-section-title">
                  <LayoutDashboard size={13} className="ds-accent-icon" />
                  <span>Embedded Looker Dashboard</span>
                </h3>

                <label className="ds-field-label" htmlFor="standalone-dashboard-input">
                  Dashboard ID, LookML Slug (<code>model::dashboard</code>), or Dashboard URL
                </label>
                <input
                  id="standalone-dashboard-input"
                  type="text"
                  className="ds-text-input"
                  value={dashboardInput}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setDashboardInput(nextVal);
                    const parsed = parseDashboardInput(nextVal);
                    const matched = dashboards.find((d) => d.id === parsed.dashboardId);
                    if (matched) {
                      setSelectedTitle(matched.title);
                    } else if (parsed.dashboardId !== resolvedDashboardId) {
                      setSelectedTitle('');
                    }
                  }}
                  placeholder="e.g. 238, model::dashboard_name, or https://looker.../dashboards/238?Region=NA"
                />

                {resolvedDashboardId && (
                  <div className="ds-parsed-route-hint">
                    <span>
                      Target Dashboard ID: <code>{resolvedDashboardId}</code>
                    </span>
                    {extractedFilterCount > 0 && (
                      <span className="ds-badge ds-badge-neutral">
                        +{extractedFilterCount} URL{' '}
                        {extractedFilterCount === 1 ? 'filter' : 'filters'} detected
                      </span>
                    )}
                    <span className="ds-route-preview">
                      Route: <code>/dashboards/{resolvedDashboardId}</code>
                    </span>
                  </div>
                )}

                <div className="ds-dashboard-picker">
                  <div className="ds-search-input-wrap">
                    <Search size={13} className="ds-search-icon" />
                    <input
                      type="text"
                      className="ds-search-input"
                      aria-label="Search available Looker dashboards"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search Looker dashboards by title or ID..."
                    />
                    {loadingDashboards && <span className="ds-spinner-xs" />}
                  </div>

                  <div
                    className="ds-dashboard-list"
                    role="listbox"
                    aria-label="Available Looker dashboards"
                  >
                    {dashboards.length === 0 ? (
                      <div className="ds-dashboard-empty">
                        {loadingDashboards
                          ? 'Searching Looker dashboards...'
                          : 'No matching dashboards found. You can still enter any Dashboard ID or URL above.'}
                      </div>
                    ) : (
                      dashboards.map((dash) => {
                        const isSelected = resolvedDashboardId === dash.id;
                        return (
                          <button
                            key={dash.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`ds-dashboard-option ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => handleSelectDashboardOption(dash)}
                          >
                            <div className="ds-dashboard-opt-main">
                              <span className="ds-dashboard-opt-title">{dash.title}</span>
                              <div className="ds-dashboard-opt-meta">
                                <code>#{dash.id}</code>
                                {dash.folderName && (
                                  <span className="ds-dashboard-folder">
                                    <Folder size={10} />
                                    <span>{dash.folderName}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                            {isSelected && <Check size={14} className="ds-accent-icon" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </section>

              <section className="ds-config-section">
                <h3 className="ds-config-section-title">
                  <Columns2 size={13} className="ds-accent-icon" />
                  <span>Right-Side Drawer Layout</span>
                </h3>

                <label className="ds-toggle-row" htmlFor="standalone-drawer-open">
                  <div className="ds-toggle-copy">
                    <span className="ds-toggle-label">
                      Expand AI Insights drawer automatically on load
                    </span>
                    <span className="ds-toggle-desc">
                      When off, the summarization drawer starts collapsed to the right rail so the
                      embedded dashboard fills the screen.
                    </span>
                  </div>
                  <input
                    id="standalone-drawer-open"
                    type="checkbox"
                    className="ds-switch-input"
                    checked={draft.defaultDrawerOpen}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        defaultDrawerOpen: e.target.checked,
                      }))
                    }
                  />
                </label>

                <div
                  className="ds-pipeline-mode-group"
                  role="radiogroup"
                  aria-label="Default Drawer Width"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.drawerWidth === 'standard'}
                    className={`ds-pipeline-option ${
                      draft.drawerWidth === 'standard' ? 'is-selected' : ''
                    }`}
                    onClick={() => setDrawerWidth('standard')}
                  >
                    <div className="ds-pipeline-opt-header">
                      <div className="ds-pipeline-opt-title">
                        <Columns2 size={13} className="ds-accent-icon" />
                        <span>Standard Drawer (500px)</span>
                      </div>
                      <span className="ds-pipeline-opt-badge">Default</span>
                    </div>
                    <span className="ds-pipeline-opt-desc">
                      Balanced split layout giving maximum horizontal width to the embedded
                      dashboard.
                    </span>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.drawerWidth === 'wide'}
                    className={`ds-pipeline-option ${
                      draft.drawerWidth === 'wide' ? 'is-selected' : ''
                    }`}
                    onClick={() => setDrawerWidth('wide')}
                  >
                    <div className="ds-pipeline-opt-header">
                      <div className="ds-pipeline-opt-title">
                        <Maximize2 size={13} className="ds-accent-icon" />
                        <span>Wide Drawer (660px)</span>
                      </div>
                    </div>
                    <span className="ds-pipeline-opt-desc">
                      Expanded reading width for side-by-side Executive Highlights and Next Steps.
                    </span>
                  </button>
                </div>
              </section>
            </div>

            {/* Right Column: AI Summarization Pipeline & Default Prompt */}
            <div className="ds-config-col">
              <section className="ds-config-section">
                <h3 className="ds-config-section-title">
                  <Zap size={13} className="ds-accent-icon" />
                  <span>AI Execution Pipeline &amp; Controls</span>
                </h3>

                <div
                  className="ds-pipeline-mode-group"
                  role="radiogroup"
                  aria-label="AI Execution Pipeline"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.tileConfig.pipelineMode === 'single_pass'}
                    className={`ds-pipeline-option ${
                      draft.tileConfig.pipelineMode === 'single_pass' ? 'is-selected' : ''
                    }`}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        tileConfig: { ...prev.tileConfig, pipelineMode: 'single_pass' },
                      }))
                    }
                  >
                    <div className="ds-pipeline-opt-header">
                      <div className="ds-pipeline-opt-title">
                        <Zap size={13} className="ds-accent-icon" />
                        <span>Fast Single-Pass</span>
                      </div>
                      <span className="ds-pipeline-opt-badge">Default &bull; ~3s</span>
                    </div>
                    <span className="ds-pipeline-opt-desc">
                      Synthesizes all dashboard tiles in 1 unified Vertex AI call.
                    </span>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.tileConfig.pipelineMode === 'parallel'}
                    className={`ds-pipeline-option ${
                      draft.tileConfig.pipelineMode === 'parallel' ? 'is-selected' : ''
                    }`}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        tileConfig: { ...prev.tileConfig, pipelineMode: 'parallel' },
                      }))
                    }
                  >
                    <div className="ds-pipeline-opt-header">
                      <div className="ds-pipeline-opt-title">
                        <Layers size={13} className="ds-accent-icon" />
                        <span>Parallel Multi-Call</span>
                      </div>
                    </div>
                    <span className="ds-pipeline-opt-desc">
                      Analyzes each tile independently before synthesizing the executive brief.
                    </span>
                  </button>
                </div>

                <label className="ds-toggle-row" htmlFor="standalone-cfg-autorun">
                  <div className="ds-toggle-copy">
                    <span className="ds-toggle-label">Auto-run insights on dashboard load</span>
                    <span className="ds-toggle-desc">
                      Automatically generate the executive brief as soon as the embedded dashboard
                      loads.
                    </span>
                  </div>
                  <input
                    id="standalone-cfg-autorun"
                    type="checkbox"
                    className="ds-switch-input"
                    checked={draft.tileConfig.autoRun}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        tileConfig: { ...prev.tileConfig, autoRun: e.target.checked },
                      }))
                    }
                  />
                </label>

                {draft.tileConfig.autoRun && (
                  <label
                    className="ds-toggle-row ds-toggle-subrow"
                    htmlFor="standalone-cfg-autorefresh"
                  >
                    <div className="ds-toggle-copy">
                      <span className="ds-toggle-label">
                        Auto-refresh when embedded filters change
                      </span>
                      <span className="ds-toggle-desc">
                        Re-run the executive brief automatically whenever the viewer updates filters
                        on the embedded dashboard.
                      </span>
                    </div>
                    <input
                      id="standalone-cfg-autorefresh"
                      type="checkbox"
                      className="ds-switch-input"
                      checked={draft.tileConfig.autoRefreshOnFilterChange}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          tileConfig: {
                            ...prev.tileConfig,
                            autoRefreshOnFilterChange: e.target.checked,
                          },
                        }))
                      }
                    />
                  </label>
                )}

                <label className="ds-toggle-row" htmlFor="standalone-cfg-nextsteps">
                  <div className="ds-toggle-copy">
                    <span className="ds-toggle-label">Recommended Next Steps</span>
                    <span className="ds-toggle-desc">
                      Include prioritized operational recommendations in the drawer brief.
                    </span>
                  </div>
                  <input
                    id="standalone-cfg-nextsteps"
                    type="checkbox"
                    className="ds-switch-input"
                    checked={draft.tileConfig.showNextSteps}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        tileConfig: {
                          ...prev.tileConfig,
                          showNextSteps: e.target.checked,
                        },
                      }))
                    }
                  />
                </label>

                <label className="ds-toggle-row" htmlFor="standalone-cfg-followups">
                  <div className="ds-toggle-copy">
                    <span className="ds-toggle-label">Suggested Follow-Up Questions</span>
                    <span className="ds-toggle-desc">
                      Generate follow-up questions for Looker Conversational Analytics.
                    </span>
                  </div>
                  <input
                    id="standalone-cfg-followups"
                    type="checkbox"
                    className="ds-switch-input"
                    checked={draft.tileConfig.showFollowUpQuestions}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        tileConfig: {
                          ...prev.tileConfig,
                          showFollowUpQuestions: e.target.checked,
                        },
                      }))
                    }
                  />
                </label>
              </section>

              <section className="ds-config-section">
                <h3 className="ds-config-section-title">
                  <Sparkles size={13} className="ds-accent-icon" />
                  <span>Default Persona &amp; Prompt</span>
                </h3>

                <div
                  className="ds-preset-pills-row"
                  role="group"
                  aria-label="Default persona preset"
                >
                  {PRESET_PROMPTS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`ds-pill-btn ${
                        draft.tileConfig.defaultPresetId === preset.id ? 'is-selected' : ''
                      }`}
                      onClick={() => handlePresetClick(preset)}
                    >
                      {preset.title}
                    </button>
                  ))}
                </div>

                <textarea
                  id="standalone-cfg-prompt"
                  className="ds-textarea ds-config-textarea"
                  rows={4}
                  maxLength={MAX_PROMPT_LENGTH}
                  value={draft.tileConfig.defaultPrompt}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      tileConfig: {
                        ...prev.tileConfig,
                        defaultPrompt: e.target.value,
                        defaultPresetId: null,
                      },
                    }))
                  }
                  placeholder="Enter analytical instructions or KPI focus areas..."
                />
              </section>
            </div>
          </div>

          <div className="ds-standalone-modal-footer">
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-btn-sm"
              onClick={handleResetDefaults}
              disabled={saving}
            >
              <RotateCcw size={13} />
              <span>Reset Defaults</span>
            </button>

            <div className="ds-standalone-modal-actions">
              {activeDashboardId && (
                <button
                  type="button"
                  className="ds-btn ds-btn-ghost"
                  onClick={onClose}
                  disabled={saving}
                >
                  Cancel
                </button>
              )}

              <button
                type="button"
                className="ds-btn ds-btn-secondary"
                disabled={!resolvedDashboardId || saving}
                onClick={handleLoadSessionOnly}
              >
                <Play size={13} />
                <span>Load for Session</span>
              </button>

              <button
                type="submit"
                className="ds-btn ds-btn-primary"
                disabled={
                  !resolvedDashboardId ||
                  !draft.tileConfig.defaultPrompt.trim() ||
                  saving
                }
              >
                <Save size={14} />
                <span>{saving ? 'Saving...' : 'Save as Default & Load'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
};
