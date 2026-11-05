import type { ExtensionSDK } from '@looker/extension-sdk';
import { appConfig } from '../config';

export function isLocalBackendUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
  }
}

export async function callBackendService<T>(
  endpoint: string,
  payload: Record<string, unknown>,
  extensionSDK: Pick<ExtensionSDK, 'fetchProxy' | 'serverProxy' | 'createSecretKeyTag'>,
  serviceBaseUrl: string
): Promise<T> {
  const normalizedBase = (serviceBaseUrl || appConfig.RESTFUL_WEBSERVICE).replace(/\/+$/, '');
  const isLocal = isLocalBackendUrl(normalizedBase);
  const proxyMethod = isLocal ? 'fetchProxy' : 'serverProxy';

  const secretValue = isLocal
    ? appConfig.DEV_GENAI_CLIENT_SECRET
    : extensionSDK.createSecretKeyTag('genai_client_secret');

  let response: Awaited<ReturnType<typeof extensionSDK.serverProxy>>;
  try {
    response = await extensionSDK[proxyMethod](`${normalizedBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Genai-Client-Secret': secretValue,
      },
      body: JSON.stringify({
        ...payload,
        client_secret: secretValue,
      }),
    });
  } catch (err) {
    const isDefaultRunApp =
      proxyMethod === 'serverProxy' && /\.run\.app(?:\/|$)/i.test(normalizedBase);
    const domainHint = isDefaultRunApp
      ? ' (Looker Core serverProxy blocks default *.run.app hostnames via Private Cloud DNS; map a custom domain to Cloud Run)'
      : '';
    const detail = err instanceof Error ? err.message : 'Proxy request failed';
    throw new Error(`Backend proxy request to ${endpoint} failed${domainHint}: ${detail}`);
  }

  if (!response.ok) {
    throw new Error(`Backend request to ${endpoint} failed with status ${response.status}`);
  }

  const rawBody = response.body;
  if (typeof rawBody === 'string') {
    return JSON.parse(rawBody) as T;
  }
  return rawBody as T;
}
