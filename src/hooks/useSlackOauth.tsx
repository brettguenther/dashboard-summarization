import { useCallback, useContext } from 'react';
import { appConfig } from '../config';
import { useExtensionHost } from '../contexts/ExtensionHostContext';
import { SummaryDataContext } from '../contexts/SummaryDataContext';
import type { ExecutiveSummaryStructured, TileSummaryCard } from '../types';
import { callBackendService } from '../utils/backendClient';

export function buildSlackBlocks(
  executiveStructured: ExecutiveSummaryStructured | null,
  executiveMarkdown: string,
  tileSummaries: TileSummaryCard[],
  dashboardUrl: string,
  showNextSteps = true
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Looker Dashboard Insights (Vertex AI)',
        emoji: true,
      },
    },
  ];

  if (dashboardUrl) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Executive Summary* generated from live Looker dashboard queries.',
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Open in Looker', emoji: true },
        url: dashboardUrl,
        action_id: 'open-looker-dashboard',
      },
    });
  }

  if (executiveStructured) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: executiveStructured.executiveOverview.slice(0, 2900),
      },
    });

    if (executiveStructured.keyHighlights.length > 0) {
      const highlightsText = executiveStructured.keyHighlights
        .map((h) => `• *${h.headline}*: ${h.detail}`)
        .join('\n')
        .slice(0, 2900);
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Key Findings*\n${highlightsText}`,
        },
      });
    }

    if (showNextSteps && executiveStructured.recommendations.length > 0) {
      const recsText = executiveStructured.recommendations
        .map((r) => `• *[${r.priority.toUpperCase()}] ${r.action}* — ${r.rationale}`)
        .join('\n')
        .slice(0, 2900);
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Recommended Next Steps*\n${recsText}`,
        },
      });
    }
  } else if (executiveMarkdown) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: executiveMarkdown.slice(0, 2900),
      },
    });
  } else {
    for (const tile of tileSummaries.slice(0, 6)) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${tile.title}*\n${tile.markdown.slice(0, 2800)}`,
        },
      });
    }
  }

  return blocks;
}

const useSlackOauth = () => {
  const { extensionSDK, lookerHostData, tileHostData } = useExtensionHost();
  const summaryCtx = useContext(SummaryDataContext);

  return useCallback(async () => {
    if (!summaryCtx) return;
    const {
      executiveStructured,
      executiveMarkdown,
      tileSummaries,
      dashboardURL,
      setToast,
    } = summaryCtx;

    if (!appConfig.SLACK_CLIENT_ID || !appConfig.CHANNEL_ID) {
      setToast({
        type: 'info',
        text: 'Configure SLACK_CLIENT_ID and CHANNEL_ID in .env (and SLACK_CLIENT_SECRET on Cloud Run) to enable Slack export.',
      });
      return;
    }

    try {
      const oauthState =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const authResp = await extensionSDK.oauth2Authenticate(
        'https://slack.com/oauth/v2/authorize',
        {
          client_id: appConfig.SLACK_CLIENT_ID,
          scope: 'chat:write,channels:read',
          response_type: 'code',
          state: oauthState,
        },
        'GET'
      );

      // Exchange authorization code server-side on Cloud Run so SLACK_CLIENT_SECRET never touches client code.
      const tokenResp = await callBackendService<{ access_token: string }>(
        '/slack/oauth-exchange',
        { code: authResp.code },
        extensionSDK,
        appConfig.RESTFUL_WEBSERVICE
      );

      const resolvedUrl =
        dashboardURL ||
        (lookerHostData?.hostUrl && tileHostData.dashboardId
          ? `${lookerHostData.hostUrl}/dashboards/${encodeURIComponent(tileHostData.dashboardId)}`
          : '');

      const blocks = buildSlackBlocks(
        executiveStructured,
        executiveMarkdown,
        tileSummaries,
        resolvedUrl
      );

      const postBody = new URLSearchParams({
        channel: appConfig.CHANNEL_ID,
        token: tokenResp.access_token,
        text: 'Looker Dashboard Insights Summary',
        blocks: JSON.stringify(blocks),
      }).toString();

      const postResp = await extensionSDK.fetchProxy('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: postBody,
      });

      if (postResp.ok && postResp.body?.ok !== false) {
        setToast({
          type: 'success',
          text: `Summary delivered to Slack channel ${appConfig.CHANNEL_ID}.`,
        });
      } else {
        setToast({
          type: 'error',
          text: 'Slack API rejected message delivery.',
        });
      }
    } catch (error) {
      console.error('Slack export error:', error);
      summaryCtx.setToast({
        type: 'error',
        text: 'Summary failed to deliver to Slack.',
      });
    }
  }, [extensionSDK, lookerHostData, summaryCtx, tileHostData.dashboardId]);
};

export default useSlackOauth;
