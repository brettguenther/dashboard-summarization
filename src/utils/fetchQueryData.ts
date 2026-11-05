import type { Query, QueryWithData } from '../types';

const MAX_CONCURRENT_QUERIES = 4;
const MAX_ROWS_PER_TILE = 100;
const queryDataCache = new Map<string, QueryWithData[]>();

export function clearQueryDataCache(): void {
  queryDataCache.clear();
}

export const fetchQueryData = async (
  queries: Query[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  core40SDK: any,
  options?: {
    cacheKey?: string;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<QueryWithData[]> => {
  if (queries.length === 0) return [];

  if (options?.cacheKey && queryDataCache.has(options.cacheKey)) {
    const cached = queryDataCache.get(options.cacheKey)!;
    options.onProgress?.(queries.length, queries.length);
    return cached;
  }

  const results: Array<QueryWithData | null> = new Array(queries.length).fill(null);
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < queries.length) {
      const currentIndex = cursor++;
      const query = queries[currentIndex];
      try {
        const response = await core40SDK.ok(
          core40SDK.run_inline_query({
            body: query.queryBody,
            result_format: 'json',
          })
        );
        const rows = Array.isArray(response)
          ? response.slice(0, MAX_ROWS_PER_TILE)
          : [];
        results[currentIndex] = {
          ...query,
          queryData: rows,
        };
      } catch (error) {
        console.error(`Failed to run inline query for tile "${query.title}":`, error);
        results[currentIndex] = null;
      } finally {
        completed += 1;
        options?.onProgress?.(completed, queries.length);
      }
    }
  }

  const workerCount = Math.min(MAX_CONCURRENT_QUERIES, queries.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const validResults = results.filter((item): item is QueryWithData => item !== null);
  if (options?.cacheKey && validResults.length > 0) {
    queryDataCache.set(options.cacheKey, validResults);
  }
  return validResults;
};
