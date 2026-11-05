import React, { useEffect, useState } from 'react';
import { Layers, RotateCcw, Save, Settings2, Sparkles, Zap } from 'lucide-react';
import type { TileConfiguration } from '../types';
import { PRESET_PROMPTS, type PresetPrompt } from '../utils/presets';
import { DEFAULT_TILE_CONFIG, MAX_PROMPT_LENGTH } from '../utils/tileConfigStorage';

export interface TileConfigPanelProps {
  config: TileConfiguration;
  saving: boolean;
  onSave: (updated: TileConfiguration) => Promise<void> | void;
}

export const TileConfigPanel: React.FC<TileConfigPanelProps> = ({
  config,
  saving,
  onSave,
}) => {
  const [draft, setDraft] = useState<TileConfiguration>(config);
  const serializedConfig = JSON.stringify(config);

  useEffect(() => {
    setDraft(JSON.parse(serializedConfig) as TileConfiguration);
  }, [serializedConfig]);

  const handlePresetClick = (preset: PresetPrompt) => {
    setDraft((prev) => ({
      ...prev,
      defaultPresetId: preset.id,
      defaultPrompt: preset.prompt,
    }));
  };

  const handleReset = () => {
    setDraft({ ...DEFAULT_TILE_CONFIG });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void onSave(draft);
  };

  const isDirty =
    draft.autoRun !== config.autoRun ||
    draft.autoRefreshOnFilterChange !== config.autoRefreshOnFilterChange ||
    draft.allowPromptOverride !== config.allowPromptOverride ||
    draft.pipelineMode !== config.pipelineMode ||
    draft.defaultPresetId !== config.defaultPresetId ||
    draft.defaultPrompt.trim() !== config.defaultPrompt.trim() ||
    draft.showNextSteps !== config.showNextSteps ||
    draft.showFollowUpQuestions !== config.showFollowUpQuestions;

  return (
    <main className="ds-config-panel" aria-label="Tile Configuration Menu">
      <form className="ds-config-form" onSubmit={handleSubmit}>
        <div className="ds-config-intro">
          <div className="ds-config-intro-title">
            <Settings2 size={15} className="ds-accent-icon" />
            <h2>Tile Configuration</h2>
          </div>
          <p>
            Configure how this tile executes and which sections appear for all viewers of this
            dashboard.
          </p>
        </div>

        <div className="ds-config-grid">
          {/* Left Column: Execution & Output Section Toggles */}
          <div className="ds-config-col">
            <section className="ds-config-section">
              <h3 className="ds-config-section-title">
                <Zap size={13} className="ds-accent-icon" />
                <span>Execution Pipeline</span>
              </h3>

              <div
                className="ds-pipeline-mode-group"
                role="radiogroup"
                aria-label="AI Execution Pipeline"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.pipelineMode === 'single_pass'}
                  className={`ds-pipeline-option ${
                    draft.pipelineMode === 'single_pass' ? 'is-selected' : ''
                  }`}
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, pipelineMode: 'single_pass' }))
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
                    Analyzes all dashboard tiles in 1 unified Vertex AI call. Recommended for
                    fast, interactive briefings.
                  </span>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.pipelineMode === 'parallel'}
                  className={`ds-pipeline-option ${
                    draft.pipelineMode === 'parallel' ? 'is-selected' : ''
                  }`}
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, pipelineMode: 'parallel' }))
                  }
                >
                  <div className="ds-pipeline-opt-header">
                    <div className="ds-pipeline-opt-title">
                      <Layers size={13} className="ds-accent-icon" />
                      <span>Parallel Multi-Call</span>
                    </div>
                  </div>
                  <span className="ds-pipeline-opt-desc">
                    Independently analyzes every tile before synthesizing the executive
                    summary (0 thinking budget).
                  </span>
                </button>
              </div>
            </section>

            <section className="ds-config-section">
              <h3 className="ds-config-section-title">Execution &amp; Viewer Controls</h3>

              <label className="ds-toggle-row" htmlFor="cfg-auto-run">
                <div className="ds-toggle-copy">
                  <span className="ds-toggle-label">Auto-run insights on dashboard load</span>
                  <span className="ds-toggle-desc">
                    Skip the setup screen and generate the executive brief automatically using the
                    default prompt.
                  </span>
                </div>
                <input
                  id="cfg-auto-run"
                  type="checkbox"
                  className="ds-switch-input"
                  checked={draft.autoRun}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, autoRun: e.target.checked }))
                  }
                />
              </label>

              {draft.autoRun && (
                <label
                  className="ds-toggle-row ds-toggle-subrow"
                  htmlFor="cfg-auto-refresh-filters"
                >
                  <div className="ds-toggle-copy">
                    <span className="ds-toggle-label">
                      Auto-refresh when dashboard filters change
                    </span>
                    <span className="ds-toggle-desc">
                      When off, filter updates display a 1-click &ldquo;Refresh Brief&rdquo; banner
                      instead of re-running immediately.
                    </span>
                  </div>
                  <input
                    id="cfg-auto-refresh-filters"
                    type="checkbox"
                    className="ds-switch-input"
                    checked={draft.autoRefreshOnFilterChange}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        autoRefreshOnFilterChange: e.target.checked,
                      }))
                    }
                  />
                </label>
              )}

              <label className="ds-toggle-row" htmlFor="cfg-allow-override">
                <div className="ds-toggle-copy">
                  <span className="ds-toggle-label">Allow viewers to refine prompt</span>
                  <span className="ds-toggle-desc">
                    Displays the Refine button so viewers can enter custom instructions and trigger
                    a new summary.
                  </span>
                </div>
                <input
                  id="cfg-allow-override"
                  type="checkbox"
                  className="ds-switch-input"
                  checked={draft.allowPromptOverride}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      allowPromptOverride: e.target.checked,
                    }))
                  }
                />
              </label>
            </section>

            <section className="ds-config-section">
              <h3 className="ds-config-section-title">Visible Insight Sections</h3>

              <label className="ds-toggle-row" htmlFor="cfg-show-next-steps">
                <div className="ds-toggle-copy">
                  <span className="ds-toggle-label">Recommended Next Steps</span>
                  <span className="ds-toggle-desc">
                    Synthesize prioritized operational recommendations in the Executive Brief and
                    exports.
                  </span>
                </div>
                <input
                  id="cfg-show-next-steps"
                  type="checkbox"
                  className="ds-switch-input"
                  checked={draft.showNextSteps}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, showNextSteps: e.target.checked }))
                  }
                />
              </label>

              <label className="ds-toggle-row" htmlFor="cfg-show-followups">
                <div className="ds-toggle-copy">
                  <span className="ds-toggle-label">Suggested Follow-Up Questions</span>
                  <span className="ds-toggle-desc">
                    Generate natural-language follow-up prompts for Looker Conversational Analytics.
                  </span>
                </div>
                <input
                  id="cfg-show-followups"
                  type="checkbox"
                  className="ds-switch-input"
                  checked={draft.showFollowUpQuestions}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      showFollowUpQuestions: e.target.checked,
                    }))
                  }
                />
              </label>
            </section>
          </div>

          {/* Right Column: Default Persona & Prompt */}
          <div className="ds-config-col ds-config-prompt-col">
            <section className="ds-config-section ds-config-prompt-section">
              <div className="ds-config-prompt-header">
                <h3 className="ds-config-section-title">
                  <Sparkles size={13} className="ds-accent-icon" />
                  <span>Default Persona &amp; Prompt</span>
                </h3>
              </div>

              <div className="ds-preset-pills-row" role="group" aria-label="Default persona preset">
                {PRESET_PROMPTS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`ds-pill-btn ${
                      draft.defaultPresetId === preset.id ? 'is-selected' : ''
                    }`}
                    onClick={() => handlePresetClick(preset)}
                  >
                    {preset.title}
                  </button>
                ))}
              </div>

              <label className="ds-field-label" htmlFor="cfg-default-prompt">
                Instructions used for Auto-Run &amp; initial viewer prompt
              </label>
              <textarea
                id="cfg-default-prompt"
                className="ds-textarea ds-config-textarea"
                rows={5}
                maxLength={MAX_PROMPT_LENGTH}
                value={draft.defaultPrompt}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    defaultPrompt: e.target.value,
                    defaultPresetId: null,
                  }))
                }
                placeholder="Enter specific KPIs, target thresholds, or analytical instructions..."
              />

              <div className="ds-config-actions">
                <button
                  type="button"
                  className="ds-btn ds-btn-ghost ds-btn-sm"
                  onClick={handleReset}
                  disabled={saving}
                >
                  <RotateCcw size={13} />
                  <span>Reset Defaults</span>
                </button>
                <button
                  type="submit"
                  className="ds-btn ds-btn-primary"
                  disabled={saving || !draft.defaultPrompt.trim()}
                >
                  <Save size={14} />
                  <span>
                    {saving
                      ? 'Saving...'
                      : isDirty
                        ? 'Save Tile Settings'
                        : 'Save Tile Settings'}
                  </span>
                </button>
              </div>
            </section>
          </div>
        </div>
      </form>
    </main>
  );
};
