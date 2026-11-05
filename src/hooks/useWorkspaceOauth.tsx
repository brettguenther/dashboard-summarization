import { useCallback, useContext } from 'react';
import { appConfig } from '../config';
import { useExtensionHost } from '../contexts/ExtensionHostContext';
import { SummaryDataContext } from '../contexts/SummaryDataContext';

const useWorkspaceOauth = () => {
  const { extensionSDK, lookerHostData, tileHostData } = useExtensionHost();
  const summaryCtx = useContext(SummaryDataContext);

  return useCallback(async () => {
    if (!summaryCtx) return;
    const { executiveMarkdown, tileSummaries, dashboardURL, setToast } = summaryCtx;

    if (!appConfig.GOOGLE_CLIENT_ID || !appConfig.SPACE_ID) {
      setToast({
        type: 'info',
        text: 'Configure GOOGLE_CLIENT_ID and SPACE_ID in .env to enable Google Chat export.',
      });
      return;
    }

    try {
      const response = await extensionSDK.oauth2Authenticate(
        'https://accounts.google.com/o/oauth2/v2/auth',
        {
          client_id: appConfig.GOOGLE_CLIENT_ID,
          scope: [
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/chat.messages',
            'https://www.googleapis.com/auth/chat.messages.create',
            'https://www.googleapis.com/auth/chat.spaces.readonly',
          ].join(' '),
          response_type: 'token',
        }
      );

      const resolvedUrl =
        dashboardURL ||
        (lookerHostData?.hostUrl && tileHostData.dashboardId
          ? `${lookerHostData.hostUrl}/dashboards/${encodeURIComponent(tileHostData.dashboardId)}`
          : '');

      const bodyLines = [
        '*Looker Dashboard Insights (Vertex AI)*',
        resolvedUrl ? `<${resolvedUrl}|Open Dashboard in Looker>` : '',
        '',
        executiveMarkdown || tileSummaries.map((t) => t.markdown).join('\n\n'),
      ].filter(Boolean);

      const messageText = bodyLines.join('\n').slice(0, 4000);
      const spacePath = appConfig.SPACE_ID.startsWith('spaces/')
        ? appConfig.SPACE_ID
        : `spaces/${encodeURIComponent(appConfig.SPACE_ID)}`;

      const messageExport = await extensionSDK.fetchProxy(
        `https://chat.googleapis.com/v1/${spacePath}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${response.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: messageText,
          }),
        }
      );

      if (messageExport.ok) {
        setToast({
          type: 'success',
          text: `Summary delivered to Google Chat (${appConfig.SPACE_ID}).`,
        });
      } else {
        setToast({
          type: 'error',
          text: `Google Chat export failed (HTTP ${messageExport.status}).`,
        });
      }
    } catch (error) {
      console.error('Google Chat export error:', error);
      summaryCtx.setToast({
        type: 'error',
        text: 'Summary failed to deliver to Google Chat.',
      });
    }
  }, [extensionSDK, lookerHostData, summaryCtx, tileHostData.dashboardId]);
};

export default useWorkspaceOauth;
