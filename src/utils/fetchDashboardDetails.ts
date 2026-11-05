import type { ExtensionSDK, Filters } from '@looker/extension-sdk';
import type { DashboardElement, DashboardMetadata, Filterable, Query } from '../types';

export function serializeDashboardFilters(
  filters: Record<string, unknown> | undefined | null
): string {
  if (!filters) return '{}';
  const sortedEntries = Object.entries(filters)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => [key, val === null ? '' : String(val)]);
  return JSON.stringify(Object.fromEntries(sortedEntries));
}

export function applyFilterToListeners(
  filterables: Filterable[] | undefined,
  baseFilters: Record<string, string> | undefined,
  dashboardFilters: Filters | undefined | null
): Record<string, string> {
  const nextFilters: Record<string, string> = { ...(baseFilters || {}) };
  if (!dashboardFilters || !Array.isArray(filterables)) {
    return nextFilters;
  }

  for (const item of filterables) {
    if (!Array.isArray(item.listen) || item.listen.length === 0) continue;
    for (const listener of item.listen) {
      const incoming = dashboardFilters[listener.dashboard_filter_name];
      if (incoming !== undefined && incoming !== null && String(incoming).trim() !== '') {
        nextFilters[listener.field] = String(incoming);
      }
    }
  }

  return nextFilters;
}

export const fetchDashboardDetails = async (
  dashboardId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  core40SDK: any,
  extensionSDK: Pick<ExtensionSDK, 'localStorageSetItem'>,
  dashboardFilters: Filters | undefined
): Promise<DashboardMetadata> => {
  const { description } = await core40SDK.ok(core40SDK.dashboard(dashboardId, 'description'));

  let elements: DashboardElement[] = [];
  if (dashboardId.includes('::')) {
    const { dashboard_elements } = await core40SDK.ok(
      core40SDK.dashboard(dashboardId, 'dashboard_elements')
    );
    elements = dashboard_elements || [];
  } else {
    elements =
      (await core40SDK.ok(
        core40SDK.dashboard_dashboard_elements(
          dashboardId,
          'query,result_maker,note_text,title,query_id'
        )
      )) || [];
  }

  const mappedQueries: Query[] = [];
  for (const element of elements) {
    const querySource = element.query || element.result_maker?.query;
    if (!querySource) continue;

    const {
      fields,
      dynamic_fields,
      view,
      model,
      filters,
      pivots,
      sorts,
      limit,
      column_limit,
      row_total,
      subtotals,
    } = querySource;

    const mergedFilters = applyFilterToListeners(
      element.result_maker?.filterables,
      filters,
      dashboardFilters
    );

    mappedQueries.push({
      queryBody: {
        fields,
        dynamic_fields,
        view,
        model,
        filters: mergedFilters,
        pivots,
        sorts,
        limit,
        column_limit,
        row_total,
        subtotals,
      },
      note_text: element.note_text || '',
      title: element.title || 'Untitled Tile',
    });
  }

  const metadata: DashboardMetadata = {
    dashboardFilters,
    dashboardId,
    queries: mappedQueries,
    description: description || '',
  };

  try {
    await extensionSDK.localStorageSetItem(
      `${dashboardId}:${serializeDashboardFilters(dashboardFilters)}`,
      JSON.stringify(metadata)
    );
  } catch {
    // Non-fatal if extension localStorage quota is reached
  }

  return metadata;
};
