import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExtensionSDK } from '@looker/extension-sdk';
import { MountPoint } from '@looker/extension-sdk';
import { App } from '../App';
import MarkdownComponent from '../components/MarkdownComponent';
import {
  areTileHostDataEquivalent,
  type ExtensionHostContextValue,
} from '../contexts/ExtensionHostContext';
import { buildSlackBlocks } from '../hooks/useSlackOauth';
import { callBackendService } from '../utils/backendClient';
import {
  applyFilterToListeners,
  serializeDashboardFilters,
} from '../utils/fetchDashboardDetails';
import { normalizeQuerySuggestions } from '../utils/generateQuerySuggestions';

describe('applyFilterToListeners', () => {
  it('immutably merges active dashboard filters and preserves base filters when incoming is empty', () => {
    const baseFilters = {
      'orders.created_date': '90 days',
      'orders.status': 'COMPLETE',
    };
    const filterables = [
      {
        listen: [
          { dashboard_filter_name: 'Timeframe', field: 'orders.created_date' },
          { dashboard_filter_name: 'Order Status', field: 'orders.status' },
        ],
      },
    ];

    const merged = applyFilterToListeners(filterables, baseFilters, {
      Timeframe: '30 days',
      'Order Status': '   ',
    });

    expect(merged).toEqual({
      'orders.created_date': '30 days',
      'orders.status': 'COMPLETE',
    });
    expect(baseFilters['orders.created_date']).toBe('90 days');
  });
});

describe('normalizeQuerySuggestions & buildSlackBlocks', () => {
  it('parses structured suggestion objects and legacy fenced JSON strings cleanly', () => {
    const structured = normalizeQuerySuggestions([
      {
        querySuggestion: 'Which region drove the YoY margin expansion?',
        rationale: 'North America margin grew 400 bps.',
        category: 'Root Cause',
      },
    ]);
    expect(structured).toHaveLength(1);
    expect(structured[0].category).toBe('Root Cause');

    const legacyFenced = normalizeQuerySuggestions(
      '```json\n[{"querySuggestion":"Compare EMEA vs APAC enterprise churn"}]\n```'
    );
    expect(legacyFenced).toEqual([
      {
        querySuggestion: 'Compare EMEA vs APAC enterprise churn',
        rationale: undefined,
        category: undefined,
      },
    ]);
  });

  it('builds valid Slack Block Kit sections from structured executive summaries', () => {
    const blocks = buildSlackBlocks(
      {
        executiveOverview: 'Total ARR grew 18% YoY led by North America.',
        keyHighlights: [
          {
            headline: 'North America Outperformance',
            detail: 'Recognized $4.82M at 64% gross margin.',
            impact: 'positive',
          },
        ],
        recommendations: [
          {
            action: 'Reallocate display spend to organic search',
            rationale: 'Display CAC ($1,280) is 3.1x higher than organic.',
            priority: 'high',
          },
        ],
      },
      '',
      [],
      'https://looker.example.com/dashboards/42'
    );

    expect(blocks.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(blocks)).toContain('North America Outperformance');
    expect(JSON.stringify(blocks)).toContain('https://looker.example.com/dashboards/42');
  });
});

describe('MarkdownComponent XSS sanitization & GFM rendering', () => {
  it('strips raw <script> and event-handler attributes while rendering GFM tables', () => {
    const maliciousMarkdown = [
      '### Revenue Summary',
      '<script>window.__xss_triggered = true;</script>',
      '<img src="x" onerror="window.__xss_img = true" />',
      '',
      '| Region | Revenue |',
      '| --- | --- |',
      '| NA | $4.8M |',
    ].join('\n');

    const { container } = render(<MarkdownComponent data={[maliciousMarkdown]} />);

    expect(container.querySelector('script')).toBeNull();
    const img = container.querySelector('img');
    if (img) {
      expect(img.getAttribute('onerror')).toBeNull();
    }
    expect(container.querySelector('table')).not.toBeNull();
    expect(screen.getByText('Revenue Summary')).toBeInTheDocument();
    expect(screen.getByText('$4.8M')).toBeInTheDocument();
  });
});

describe('callBackendService proxy routing', () => {
  it('uses serverProxy and Looker secret key tag for remote Cloud Run URLs', async () => {
    const fetchProxy = vi.fn();
    const serverProxy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { status: 'ok' },
    });
    const createSecretKeyTag = vi.fn((key: string) => `{{${key}}}`);

    const res = await callBackendService<{ status: string }>(
      '/generateSummary',
      { querySummaries: ['tile 1'] },
      { fetchProxy, serverProxy, createSecretKeyTag } as unknown as Pick<
        ExtensionSDK,
        'fetchProxy' | 'serverProxy' | 'createSecretKeyTag'
      >,
      'https://dashboard-summarization-xyz.a.run.app/'
    );

    expect(res.status).toBe('ok');
    expect(fetchProxy).not.toHaveBeenCalled();
    expect(createSecretKeyTag).toHaveBeenCalledWith('genai_client_secret');
    expect(serverProxy).toHaveBeenCalledWith(
      'https://dashboard-summarization-xyz.a.run.app/generateSummary',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Genai-Client-Secret': '{{genai_client_secret}}',
        }),
      })
    );
  });

  it('surfaces Looker Core custom domain guidance when serverProxy fails against a default *.run.app URL', async () => {
    const fetchProxy = vi.fn();
    const serverProxy = vi
      .fn()
      .mockRejectedValue(new Error('Unexpected error calling response proxy'));
    const createSecretKeyTag = vi.fn((key: string) => `{{${key}}}`);

    await expect(
      callBackendService(
        '/generateQuerySummary',
        { query: {} },
        { fetchProxy, serverProxy, createSecretKeyTag } as unknown as Pick<
          ExtensionSDK,
          'fetchProxy' | 'serverProxy' | 'createSecretKeyTag'
        >,
        'https://dashboard-summarization-service-xyz.a.run.app'
      )
    ).rejects.toThrow(/blocks default \*\.run\.app hostnames/);
  });
});

describe('DashboardSummarization end-to-end UI flow', () => {
  function createMockHost(filters: Record<string, string>) {
    const proxyHandler = vi.fn(async (url: string) => {
      if (url.endsWith('/generateExecutivePackage')) {
        return {
          ok: true,
          status: 200,
          body: {
            summary: '## Executive Overview\nPortfolio ARR expanded 18% YoY.',
            structured: {
              executiveOverview:
                'Portfolio ARR expanded 18% YoY with strong North America margin leverage.',
              keyHighlights: [
                {
                  headline: 'North America Margin Leadership',
                  detail: '$4.82M net revenue at 64% gross margin.',
                  impact: 'positive',
                },
              ],
              recommendations: [
                {
                  action: 'Shift Q3 paid display budget to organic content',
                  rationale: 'Organic search converts at 14.2% vs 3.9% for display.',
                  priority: 'high',
                },
              ],
            },
            tileSummaries: [
              {
                title: 'Quarterly Revenue by Region',
                headlineTakeaway: 'North America generated $4.82M (+21% YoY).',
                bulletPoints: ['Gross margin expanded to 64%.'],
                markdown:
                  '## Quarterly Revenue\n- **North America** generated **$4.82M** (+21% YoY).\n> Gross margin expanded to 64%.',
              },
              {
                title: 'Channel Acquisition Efficiency',
                headlineTakeaway: 'Organic search converts at 14.2% vs 3.9% for display.',
                bulletPoints: ['Paid display CAC spiked 18%.'],
                markdown:
                  '## Channel Efficiency\n- **Organic search** converts at **14.2%**.\n- Paid display CAC spiked 18%.',
              },
            ],
            suggestions: [
              {
                querySuggestion: 'Break down EMEA YoY revenue decline by enterprise sub-segment',
                rationale: 'EMEA declined 4% YoY despite steady gross margins.',
                category: 'Variance Analysis',
              },
            ],
          },
        };
      }
      if (url.endsWith('/generateQuerySummary')) {
        return {
          ok: true,
          status: 200,
          body: {
            summary:
              '## Quarterly Revenue\n- **North America** generated **$4.82M** (+21% YoY).\n> Gross margin expanded to 64%.',
          },
        };
      }
      if (url.endsWith('/generateSummary')) {
        return {
          ok: true,
          status: 200,
          body: {
            summary: '## Executive Overview\nPortfolio ARR expanded 18% YoY.',
            structured: {
              executiveOverview:
                'Portfolio ARR expanded 18% YoY with strong North America margin leverage.',
              keyHighlights: [
                {
                  headline: 'North America Margin Leadership',
                  detail: '$4.82M net revenue at 64% gross margin.',
                  impact: 'positive',
                },
              ],
              recommendations: [
                {
                  action: 'Shift Q3 paid display budget to organic content',
                  rationale: 'Organic search converts at 14.2% vs 3.9% for display.',
                  priority: 'high',
                },
              ],
            },
          },
        };
      }
      if (url.endsWith('/generateQuerySuggestions')) {
        return {
          ok: true,
          status: 200,
          body: {
            suggestions: [
              {
                querySuggestion: 'Break down EMEA YoY revenue decline by enterprise sub-segment',
                rationale: 'EMEA declined 4% YoY despite steady gross margins.',
                category: 'Variance Analysis',
              },
            ],
          },
        };
      }
      return { ok: false, status: 404, body: {} };
    });

    const extensionSDK = {
      lookerHostData: {
        hostUrl: 'https://looker.example.com',
        hostOrigin: 'https://looker.example.com',
        mountPoint: MountPoint.dashboardTile,
      },
      createSecretKeyTag: (k: string) => `{{${k}}}`,
      localStorageSetItem: vi.fn().mockResolvedValue(true),
      clipboardWrite: vi.fn().mockResolvedValue(undefined),
      openBrowserWindow: vi.fn(),
      fetchProxy: proxyHandler,
      serverProxy: proxyHandler,
      rendered: vi.fn(),
    } as unknown as ExtensionSDK;

    const elements = [
      {
        title: 'Quarterly Revenue by Region',
        note_text: 'Recognized net revenue.',
        query: {
          model: 'sales',
          view: 'order_items',
          fields: ['orders.region', 'order_items.total_revenue'],
          filters: {},
        },
        result_maker: {
          filterables: [{ listen: [{ dashboard_filter_name: 'Timeframe', field: 'orders.date' }] }],
        },
      },
      {
        title: 'Channel Acquisition Efficiency',
        note_text: 'Pipeline conversion.',
        query: {
          model: 'sales',
          view: 'attribution',
          fields: ['attribution.channel', 'attribution.cac'],
          filters: {},
        },
        result_maker: { filterables: [] },
      },
    ];

    const core40SDK = {
      ok: async <T,>(val: Promise<T> | T) => val,
      artifact: vi.fn().mockResolvedValue([]),
      update_artifacts: vi.fn().mockResolvedValue([]),
      dashboard: vi.fn().mockResolvedValue({
        description: 'Executive sales overview',
        dashboard_elements: elements,
      }),
      dashboard_dashboard_elements: vi.fn().mockResolvedValue(elements),
      run_inline_query: vi.fn().mockResolvedValue([{ 'orders.region': 'NA', revenue: 4820000 }]),
    };

    const hostValue: ExtensionHostContextValue = {
      extensionSDK,
      core40SDK,
      tileHostData: {
        dashboardId: 'dash_exec_101',
        dashboardFilters: filters,
      },
      lookerHostData: {
        extensionId: 'dashboard-summarization::dashboard-summarization',
        lookerVersion: '26.20.0',
        hostUrl: 'https://looker.example.com',
        hostOrigin: 'https://looker.example.com',
        mountPoint: MountPoint.dashboardTile,
        extensionDashboardTileEnabled: true,
      },
      isPreviewMode: false,
      connectionError: null,
    };

    return { hostValue, proxyHandler, extensionSDK };
  }

  it('loads tiles, synthesizes Executive Brief + Tile Breakdown + Suggestions, and detects filter changes', async () => {
    const initial = createMockHost({ Timeframe: 'Last 90 Days' });
    const { rerender } = render(<App hostOverride={initial.hostValue} />);

    await waitFor(() => {
      expect(screen.getByText('2 tiles ready')).toBeInTheDocument();
    });
    expect(screen.getByText('Last 90 Days')).toBeInTheDocument();

    const generateBtn = screen.getByRole('button', { name: /Generate Insights/i });
    expect(generateBtn).not.toBeDisabled();
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(
        screen.getByText(
          'Portfolio ARR expanded 18% YoY with strong North America margin leverage.'
        )
      ).toBeInTheDocument();
    });

    expect(screen.getByText('North America Margin Leadership')).toBeInTheDocument();
    expect(
      screen.getByText('Shift Q3 paid display budget to organic content')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Break down EMEA YoY revenue decline by enterprise sub-segment')
    ).toBeInTheDocument();

    // Verify PDF export button is removed while slim header Refresh & Refine buttons exist
    expect(screen.queryByRole('button', { name: /PDF/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refine/i })).toBeInTheDocument();

    // Switch to Tiles tab and verify per-tile cards rendered
    const tilesTab = screen.getByRole('tab', { name: /Tiles \(2\/2\)/i });
    fireEvent.click(tilesTab);
    expect(screen.getByText('Quarterly Revenue by Region')).toBeInTheDocument();
    expect(screen.getByText('Channel Acquisition Efficiency')).toBeInTheDocument();

    // Simulate dashboard filter update and verify stale banner surfaces
    const updatedHost: ExtensionHostContextValue = {
      ...initial.hostValue,
      tileHostData: {
        dashboardId: 'dash_exec_101',
        dashboardFilters: { Timeframe: 'Last 30 Days' },
      },
    };
    rerender(<App hostOverride={updatedHost} />);

    await waitFor(() => {
      expect(
        screen.getByText('Dashboard filters changed since this summary was generated.')
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Refresh Brief/i })).toBeInTheDocument();
  });

  it('activates TileConfigPanel in Dashboard Edit mode and saves configuration via Looker Artifact Store', async () => {
    const initial = createMockHost({ Timeframe: 'Last 90 Days' });
    initial.hostValue.tileHostData = {
      dashboardId: 'dash_exec_101',
      elementId: '1583',
      isDashboardEditing: true,
      dashboardFilters: { Timeframe: 'Last 90 Days' },
    };

    render(<App hostOverride={initial.hostValue} />);

    await waitFor(() => {
      expect(screen.getByText('Tile Configuration')).toBeInTheDocument();
    });
    expect(screen.getByText('Edit Mode')).toBeInTheDocument();

    const autoRunCheckbox = screen.getByLabelText(/Auto-run insights on dashboard load/i);
    const nextStepsCheckbox = screen.getByLabelText(/Recommended Next Steps/i);
    const followUpsCheckbox = screen.getByLabelText(/Suggested Follow-Up Questions/i);
    const promptTextarea = screen.getByLabelText(
      /Instructions used for Auto-Run & initial viewer prompt/i
    );

    fireEvent.click(autoRunCheckbox);
    fireEvent.click(nextStepsCheckbox);
    fireEvent.click(followUpsCheckbox);
    fireEvent.change(promptTextarea, {
      target: { value: 'Auto-summarize YoY margin drivers concisely.' },
    });

    const parallelOption = screen.getByRole('radio', { name: /Parallel Multi-Call/i });
    fireEvent.click(parallelOption);

    const saveBtn = screen.getByRole('button', { name: /Save Tile Settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(initial.hostValue.core40SDK.update_artifacts).toHaveBeenCalledTimes(1);
    });

    const [namespace, payload] = initial.hostValue.core40SDK.update_artifacts.mock.calls[0];
    expect(namespace).toBe('dashboard_summarization_config');
    expect(payload[0].key).toBe('tile_dash_exec_101_1583');
    const savedConfig = JSON.parse(payload[0].value);
    expect(savedConfig).toMatchObject({
      autoRun: true,
      autoRefreshOnFilterChange: false,
      allowPromptOverride: true,
      pipelineMode: 'parallel',
      defaultPrompt: 'Auto-summarize YoY margin drivers concisely.',
      showNextSteps: false,
      showFollowUpQuestions: false,
    });
  });

  it('auto-runs on load with custom prompt and respects section visibility & prompt lock toggles', async () => {
    const initial = createMockHost({ Timeframe: 'Last 90 Days' });
    initial.hostValue.tileHostData = {
      dashboardId: 'dash_exec_101',
      elementId: '1583',
      isDashboardEditing: false,
      dashboardFilters: { Timeframe: 'Last 90 Days' },
    };
    initial.hostValue.core40SDK.artifact = vi.fn().mockResolvedValue([
      {
        key: 'tile_dash_exec_101_1583',
        version: 2,
        value: JSON.stringify({
          autoRun: true,
          autoRefreshOnFilterChange: false,
          allowPromptOverride: false,
          defaultPresetId: null,
          defaultPrompt: 'Focus strictly on North America gross margin.',
          showNextSteps: false,
          showFollowUpQuestions: false,
        }),
      },
    ]);

    render(<App hostOverride={initial.hostValue} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'Portfolio ARR expanded 18% YoY with strong North America margin leverage.'
        )
      ).toBeInTheDocument();
    });

    // Verify composer was bypassed and custom prompt + includeNextSteps: false were sent via single-pass
    const packageCall = initial.proxyHandler.mock.calls.find(([url]) =>
      String(url).endsWith('/generateExecutivePackage')
    );
    expect(packageCall).toBeDefined();
    const packageBody = JSON.parse((packageCall as unknown as [string, { body: string }])[1].body);
    expect(packageBody.prompt).toBe('Focus strictly on North America gross margin.');
    expect(packageBody.includeNextSteps).toBe(false);

    // Verify /generateQuerySuggestions was completely skipped
    const suggestCall = initial.proxyHandler.mock.calls.find(([url]) =>
      String(url).endsWith('/generateQuerySuggestions')
    );
    expect(suggestCall).toBeUndefined();

    // Verify Recommended Next Steps, Follow-Up Suggestions, and Refine button are hidden
    expect(screen.queryByText('Recommended Next Steps')).toBeNull();
    expect(
      screen.queryByText('Shift Q3 paid display budget to organic content')
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /^Refine$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^Refresh$/i })).toBeInTheDocument();
  });

  it('runs parallel multi-call pipeline when pipelineMode is set to parallel in tile configuration', async () => {
    const initial = createMockHost({ Timeframe: 'Last 90 Days' });
    initial.hostValue.tileHostData = {
      dashboardId: 'dash_exec_101',
      elementId: '1583',
      isDashboardEditing: false,
      dashboardFilters: { Timeframe: 'Last 90 Days' },
    };
    initial.hostValue.core40SDK.artifact = vi.fn().mockResolvedValue([
      {
        key: 'tile_dash_exec_101_1583',
        version: 2,
        value: JSON.stringify({
          autoRun: true,
          pipelineMode: 'parallel',
          defaultPresetId: null,
          defaultPrompt: 'Evaluate channel efficiency and revenue.',
          showNextSteps: true,
          showFollowUpQuestions: true,
        }),
      },
    ]);

    render(<App hostOverride={initial.hostValue} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'Portfolio ARR expanded 18% YoY with strong North America margin leverage.'
        )
      ).toBeInTheDocument();
    });

    // In parallel mode, individual query summaries and executive summary are called
    const tileSummaryCalls = initial.proxyHandler.mock.calls.filter(([url]) =>
      String(url).endsWith('/generateQuerySummary')
    );
    expect(tileSummaryCalls.length).toBeGreaterThanOrEqual(2);

    const execSummaryCall = initial.proxyHandler.mock.calls.find(([url]) =>
      String(url).endsWith('/generateSummary')
    );
    expect(execSummaryCall).toBeDefined();

    const suggestCall = initial.proxyHandler.mock.calls.find(([url]) =>
      String(url).endsWith('/generateQuerySuggestions')
    );
    expect(suggestCall).toBeDefined();
  });

  it('ignores hover-triggered TILE_HOST_DATA cycles with cloned dashboardFilters references and only reloads on real filter or Run changes', async () => {
    expect(
      serializeDashboardFilters({ Segment: 'Enterprise', Timeframe: '90 days' })
    ).toBe(serializeDashboardFilters({ Timeframe: '90 days', Segment: 'Enterprise' }));

    expect(
      areTileHostDataEquivalent(
        {
          dashboardId: 'dash_exec_101',
          elementId: '213',
          dashboardFilters: { Timeframe: '90 days', Segment: 'All' },
          lastRunStartTime: 1000,
        },
        {
          dashboardId: 'dash_exec_101',
          elementId: '213',
          dashboardFilters: { Segment: 'All', Timeframe: '90 days' },
          lastRunStartTime: 1000,
        }
      )
    ).toBe(true);

    expect(
      areTileHostDataEquivalent(
        {
          dashboardId: 'dash_exec_101',
          dashboardFilters: { Timeframe: '90 days' },
          lastRunStartTime: 1000,
        },
        {
          dashboardId: 'dash_exec_101',
          dashboardFilters: { Timeframe: '30 days' },
          lastRunStartTime: 1000,
        }
      )
    ).toBe(false);

    const initial = createMockHost({ Timeframe: 'Last 90 Days' });
    initial.hostValue.tileHostData.lastRunStartTime = 1700000000000;
    const { rerender } = render(<App hostOverride={initial.hostValue} />);

    await waitFor(() => {
      expect(screen.getByText('2 tiles ready')).toBeInTheDocument();
    });
    expect(initial.hostValue.core40SDK.dashboard).toHaveBeenCalledTimes(1);
    expect(initial.hostValue.core40SDK.dashboard_dashboard_elements).toHaveBeenCalledTimes(1);

    // Simulate mouseenter + mouseleave posting freshly cloned dashboardFilters objects with identical values
    rerender(
      <App
        hostOverride={{
          ...initial.hostValue,
          tileHostData: {
            dashboardId: 'dash_exec_101',
            dashboardFilters: { Timeframe: 'Last 90 Days' },
            lastRunStartTime: 1700000000000,
          },
        }}
      />
    );
    rerender(
      <App
        hostOverride={{
          ...initial.hostValue,
          tileHostData: {
            dashboardId: 'dash_exec_101',
            dashboardFilters: { Timeframe: 'Last 90 Days' },
            lastRunStartTime: 1700000000000,
          },
        }}
      />
    );

    expect(screen.queryByText('Inspecting dashboard...')).toBeNull();
    expect(initial.hostValue.core40SDK.dashboard).toHaveBeenCalledTimes(1);
    expect(initial.hostValue.core40SDK.dashboard_dashboard_elements).toHaveBeenCalledTimes(1);

    // Simulate explicit dashboard Run button advancing lastRunStartTime
    rerender(
      <App
        hostOverride={{
          ...initial.hostValue,
          tileHostData: {
            dashboardId: 'dash_exec_101',
            dashboardFilters: { Timeframe: 'Last 90 Days' },
            lastRunStartTime: 1700000005000,
          },
        }}
      />
    );

    await waitFor(() => {
      expect(initial.hostValue.core40SDK.dashboard).toHaveBeenCalledTimes(2);
    });
  });
});
