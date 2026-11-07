import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExtensionSDK } from '@looker/extension-sdk';
import { MountPoint } from '@looker/extension-sdk';
import { App } from '../App';
import type { ExtensionHostContextValue } from '../contexts/ExtensionHostContext';
import {
  buildStandaloneRoute,
  extractFiltersFromEmbedUrl,
  loadStandaloneConfig,
  parseDashboardInput,
  saveStandaloneConfig,
  STANDALONE_CONFIG_KEY,
} from '../utils/standaloneConfigStorage';
import { DEFAULT_TILE_CONFIG } from '../utils/tileConfigStorage';

const embedChainMocks = {
  init: vi.fn(),
  createDashboardWithId: vi.fn(),
  appendTo: vi.fn(),
  on: vi.fn(),
  withParams: vi.fn(),
  build: vi.fn(),
  connect: vi.fn(),
};

vi.mock('@looker/embed-sdk', () => ({
  getEmbedSDK: () => {
    const builder = {
      appendTo: (...args: unknown[]) => {
        embedChainMocks.appendTo(...args);
        return builder;
      },
      on: (...args: unknown[]) => {
        embedChainMocks.on(...args);
        return builder;
      },
      withParams: (...args: unknown[]) => {
        embedChainMocks.withParams(...args);
        return builder;
      },
      build: () => {
        embedChainMocks.build();
        return {
          connect: () => {
            embedChainMocks.connect();
            return Promise.resolve({ loadDashboard: vi.fn() });
          },
        };
      },
    };
    return {
      init: (...args: unknown[]) => embedChainMocks.init(...args),
      createDashboardWithId: (id: string) => {
        embedChainMocks.createDashboardWithId(id);
        return builder;
      },
    };
  },
}));

describe('standaloneConfigStorage & URL route helpers', () => {
  it('parses raw IDs, LookML slugs, extension routes, and full Looker URLs while stripping internal query params', () => {
    expect(parseDashboardInput('238')).toEqual({
      dashboardId: '238',
      filters: {},
    });

    expect(
      parseDashboardInput('consumer_banking::consumer_banking_executive_command_center')
    ).toEqual({
      dashboardId: 'consumer_banking::consumer_banking_executive_command_center',
      filters: {},
    });

    expect(
      parseDashboardInput(
        '/dashboards/238?dashboard_id=238&Timeframe=Last+30+Days&Region=North+America&sdk=2&embed_domain=https://looker.example.com'
      )
    ).toEqual({
      dashboardId: '238',
      filters: {
        Timeframe: 'Last 30 Days',
        Region: 'North America',
      },
    });

    expect(
      parseDashboardInput(
        'https://looker.example.com/embed/dashboards/235?Segment=Enterprise&_theme=%7B%7D'
      )
    ).toEqual({
      dashboardId: '235',
      filters: {
        Segment: 'Enterprise',
      },
    });
  });

  it('builds shareable standalone routes and extracts filters from page:changed URLs', () => {
    const route = buildStandaloneRoute('238', {
      Timeframe: 'Last 90 Days',
      sdk: '2',
    });
    expect(route).toBe('/dashboards/238?dashboard_id=238&Timeframe=Last+90+Days');

    const extracted = extractFiltersFromEmbedUrl(
      'https://looker.example.com/embed/dashboards/238?Timeframe=Last+30+Days&Segment=Commercial&sdk=2&embed_domain=https://looker.example.com'
    );
    expect(extracted).toEqual({
      Timeframe: 'Last 30 Days',
      Segment: 'Commercial',
    });
  });

  it('saves and loads standalone workspace config via CustomerArtifactStore and saveContextData', async () => {
    const updateArtifacts = vi.fn().mockResolvedValue([]);
    const artifact = vi.fn().mockResolvedValue([
      {
        key: STANDALONE_CONFIG_KEY,
        version: 1,
        value: JSON.stringify({
          defaultDashboardId: '238',
          defaultDashboardTitle: 'Apex Executive Command Center',
          defaultDrawerOpen: false,
          drawerWidth: 'wide',
          tileConfig: {
            ...DEFAULT_TILE_CONFIG,
            autoRun: true,
          },
        }),
      },
    ]);
    const core40SDK = {
      ok: async <T,>(v: Promise<T> | T) => v,
      artifact,
      update_artifacts: updateArtifacts,
    };
    const extensionSDK = {
      localStorageGetItem: vi.fn().mockResolvedValue(null),
      localStorageSetItem: vi.fn().mockResolvedValue(true),
      getContextData: vi.fn().mockReturnValue(undefined),
      saveContextData: vi.fn().mockResolvedValue(undefined),
      refreshContextData: vi.fn().mockResolvedValue(undefined),
    };

    const loaded = await loadStandaloneConfig(core40SDK, extensionSDK, false);
    expect(loaded.defaultDashboardId).toBe('238');
    expect(loaded.defaultDrawerOpen).toBe(false);
    expect(loaded.drawerWidth).toBe('wide');
    expect(loaded.tileConfig.autoRun).toBe(true);

    const saved = await saveStandaloneConfig(
      core40SDK,
      extensionSDK,
      {
        ...loaded,
        defaultDashboardId: '235',
      },
      false
    );
    expect(saved.persistedToArtifactStore).toBe(true);
    expect(updateArtifacts).toHaveBeenCalledTimes(1);
    expect(extensionSDK.saveContextData).toHaveBeenCalledTimes(1);
  });
});

describe('StandaloneWorkspace split-screen layout & drawer controls', () => {
  function createStandaloneMockHost(route = '/dashboards/238?dashboard_id=238&Timeframe=90+days') {
    const updateExtensionRoute = vi.fn();
    const elements = [
      {
        title: 'Net Interest Income by Region',
        note_text: 'Core banking NII.',
        query: {
          model: 'banking',
          view: 'accounts',
          fields: ['accounts.region', 'accounts.nii'],
          filters: {},
        },
        result_maker: { filterables: [] },
      },
    ];

    const core40SDK = {
      ok: async <T,>(v: Promise<T> | T) => v,
      artifact: vi.fn().mockResolvedValue([]),
      update_artifacts: vi.fn().mockResolvedValue([]),
      dashboard: vi.fn().mockResolvedValue({
        id: '238',
        title: 'Apex National Bank — Executive Command Center',
        description: 'Executive banking command center',
        dashboard_elements: elements,
      }),
      dashboard_dashboard_elements: vi.fn().mockResolvedValue(elements),
      run_inline_query: vi.fn().mockResolvedValue([{ 'accounts.region': 'NA', nii: 4820000 }]),
      search_dashboards: vi.fn().mockResolvedValue([
        {
          id: '238',
          title: 'Apex National Bank — Executive Command Center',
          folder: { name: 'Shared' },
        },
        {
          id: '235',
          title: 'Sandbox Look Orders Dashboard Summarization',
          folder: { name: 'Shared' },
        },
      ]),
    };

    const extensionSDK = {
      lookerHostData: {
        hostUrl: 'https://looker.example.com',
        hostOrigin: 'https://looker.example.com',
        mountPoint: MountPoint.standalone,
        route,
      },
      createSecretKeyTag: (k: string) => `{{${k}}}`,
      localStorageGetItem: vi.fn().mockResolvedValue(null),
      localStorageSetItem: vi.fn().mockResolvedValue(true),
      getContextData: vi.fn().mockReturnValue(undefined),
      saveContextData: vi.fn().mockResolvedValue(undefined),
      refreshContextData: vi.fn().mockResolvedValue(undefined),
      clipboardWrite: vi.fn().mockResolvedValue(undefined),
      openBrowserWindow: vi.fn(),
      updateTitle: vi.fn(),
      clientRouteChanged: vi.fn(),
      fetchProxy: vi.fn(),
      serverProxy: vi.fn(),
      rendered: vi.fn(),
    } as unknown as ExtensionSDK;

    const hostValue: ExtensionHostContextValue = {
      extensionSDK,
      core40SDK,
      tileHostData: {},
      lookerHostData: {
        extensionId: 'dashboard-summarization::dashboard-summarization',
        lookerVersion: '26.20.0',
        hostUrl: 'https://looker.example.com',
        hostOrigin: 'https://looker.example.com',
        mountPoint: MountPoint.standalone,
        route,
        extensionDashboardTileEnabled: true,
      },
      isPreviewMode: false,
      isStandaloneMount: true,
      extensionRoute: route,
      updateExtensionRoute,
      connectionError: null,
    };

    return { hostValue, core40SDK, extensionSDK, updateExtensionRoute };
  }

  it('embeds the URL-designated dashboard via @looker/embed-sdk, syncs drawer metadata, and supports expand/collapse & width toggles', async () => {
    embedChainMocks.init.mockClear();
    embedChainMocks.createDashboardWithId.mockClear();

    const { hostValue } = createStandaloneMockHost(
      '/dashboards/238?dashboard_id=238&Timeframe=Last+90+Days'
    );
    render(<App hostOverride={hostValue} />);

    // Wait for dashboard #238 to be resolved and embedded
    await waitFor(() => {
      expect(embedChainMocks.createDashboardWithId).toHaveBeenCalledWith('238');
    });
    expect(embedChainMocks.init).toHaveBeenCalledWith('https://looker.example.com');
    expect(screen.getByTestId('looker-embed-container')).toBeInTheDocument();

    // Right-hand drawer loads the 1 query tile for dashboard 238
    await waitFor(() => {
      expect(screen.getByText('1 tile ready')).toBeInTheDocument();
    });

    const drawer = screen.getByLabelText('AI Dashboard Summarization Drawer');
    expect(drawer.className).toContain('is-open');
    expect(drawer.className).toContain('is-standard');

    // Toggle to Wide Drawer (660px)
    const widthBtn = screen.getByRole('button', { name: /Wide Drawer/i });
    fireEvent.click(widthBtn);
    expect(drawer.className).toContain('is-wide');

    // Collapse the right-hand drawer to the slim vertical rail
    const collapseBtn = screen.getByRole('button', { name: /Collapse Insights/i });
    fireEvent.click(collapseBtn);
    expect(drawer.className).toContain('is-collapsed');

    // Re-expand via the vertical rail button
    const railExpandBtn = screen.getByRole('button', {
      name: /Expand AI Dashboard Insights Drawer/i,
    });
    fireEvent.click(railExpandBtn);
    expect(drawer.className).toContain('is-open');
  });

  it('allows searching and switching dashboards in StandaloneSettingsModal and updates the URL route', async () => {
    const { hostValue, core40SDK, updateExtensionRoute } = createStandaloneMockHost(
      '/dashboards/238?dashboard_id=238'
    );
    render(<App hostOverride={hostValue} />);

    await waitFor(() => {
      expect(screen.getByText('1 tile ready')).toBeInTheDocument();
    });

    // Open Workspace Settings Modal
    const settingsBtn = screen.getByRole('button', { name: /Workspace Settings/i });
    fireEvent.click(settingsBtn);

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /Standalone Workspace & Dashboard Settings/i })
      ).toBeInTheDocument();
    });

    // Verify available dashboards were fetched via search_dashboards
    await waitFor(() => {
      expect(
        screen.getByText('Sandbox Look Orders Dashboard Summarization')
      ).toBeInTheDocument();
    });

    // Click dashboard #235 in the list
    fireEvent.click(screen.getByText('Sandbox Look Orders Dashboard Summarization'));

    // Save as Default & Load
    const saveBtn = screen.getByRole('button', { name: /Save as Default & Load/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(core40SDK.update_artifacts).toHaveBeenCalled();
    });

    // Verify URL route updated to /dashboards/235?dashboard_id=235
    await waitFor(() => {
      expect(updateExtensionRoute).toHaveBeenCalledWith('/dashboards/235?dashboard_id=235');
    });
  });
});
