import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';

export const DEFAULT_MODEL_ID = 'gemini-3.5-flash-lite';
const MAX_INSTRUCTION_CHARS = 4000;
const MAX_QUERIES_PER_REQUEST = 50;
const DEFAULT_THINKING_BUDGET = 0;

export function writeStructuredLog(severity, message, metadata = {}) {
  const entry = {
    severity,
    message,
    component: 'dashboard-summarization-logs',
    timestamp: new Date().toISOString(),
    ...metadata,
  };
  const serialized = JSON.stringify(entry);
  if (severity === 'ERROR') {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
  return entry;
}

export function safeCompareSecret(provided, expected) {
  if (
    typeof provided !== 'string' ||
    typeof expected !== 'string' ||
    provided.length === 0 ||
    expected.length === 0
  ) {
    return false;
  }
  const providedDigest = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

export function createVertexClient({ project, location }) {
  if (!project) {
    throw new Error(
      'Missing GCP project ID. Set GOOGLE_CLOUD_PROJECT or PROJECT environment variable.'
    );
  }
  return new GoogleGenAI({
    vertexai: true,
    project,
    location: location || 'global',
  });
}

function sanitizeInstruction(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, MAX_INSTRUCTION_CHARS);
}

function buildExecutiveMarkdown(structured) {
  const lines = ['## Executive Overview', '', structured.executiveOverview.trim(), ''];

  if (Array.isArray(structured.keyHighlights) && structured.keyHighlights.length > 0) {
    lines.push('## Key Findings', '');
    for (const item of structured.keyHighlights) {
      const prefix =
        item.impact === 'positive'
          ? '[Positive]'
          : item.impact === 'negative'
            ? '[Risk]'
            : '[Insight]';
      lines.push(`* **${prefix} ${item.headline}**: ${item.detail}`);
    }
    lines.push('');
  }

  if (Array.isArray(structured.recommendations) && structured.recommendations.length > 0) {
    lines.push('## Recommended Next Steps', '');
    for (const rec of structured.recommendations) {
      const badge = rec.priority === 'high' ? 'High Priority' : 'Follow-Up';
      lines.push(`* **[${badge}] ${rec.action}** — ${rec.rationale}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

function buildTileMarkdown(item) {
  const lines = [
    `### ${item.tileTitle}`,
    '',
    `> ${item.headlineTakeaway.trim()}`,
    '',
  ];
  if (Array.isArray(item.bulletPoints)) {
    for (const b of item.bulletPoints) {
      lines.push(`* ${b}`);
    }
  }
  return lines.join('\n').trim();
}

function resolveThinkingBudget(reqBudget, defaultBudget) {
  if (typeof reqBudget === 'number' && Number.isFinite(reqBudget) && reqBudget >= 0) {
    return reqBudget;
  }
  return defaultBudget;
}

export function createApp(options = {}) {
  const storedClientSecret =
    options.storedClientSecret ?? process.env.GENAI_CLIENT_SECRET ?? '';
  const project =
    options.project ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.PROJECT ?? '';
  const location =
    options.location ??
    process.env.GOOGLE_CLOUD_LOCATION ??
    process.env.VERTEX_LOCATION ??
    'global';
  const modelId = options.modelId ?? process.env.MODEL_ID ?? DEFAULT_MODEL_ID;
  const tileModelId = options.tileModelId ?? process.env.TILE_MODEL_ID ?? modelId;
  const defaultThinkingBudget =
    options.thinkingBudget ??
    (process.env.THINKING_BUDGET !== undefined
      ? Number(process.env.THINKING_BUDGET)
      : DEFAULT_THINKING_BUDGET);
  const slackClientId = options.slackClientId ?? process.env.SLACK_CLIENT_ID ?? '';
  const slackClientSecret =
    options.slackClientSecret ?? process.env.SLACK_CLIENT_SECRET ?? '';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let aiClient = options.aiClient ?? null;
  const getAiClient = () => {
    if (!aiClient) {
      aiClient = createVertexClient({ project, location });
    }
    return aiClient;
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const allowedOrigin = process.env.CORS_ORIGIN || true;
  app.use(
    cors({
      origin: allowedOrigin,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Genai-Client-Secret'],
    })
  );

  const verifyClientSecret = (req, res, next) => {
    const provided =
      req.get('x-genai-client-secret') ?? req.body?.client_secret ?? '';
    if (!safeCompareSecret(provided, storedClientSecret)) {
      writeStructuredLog('WARNING', 'Rejected request with invalid or missing client secret', {
        endpoint: req.path,
      });
      return res.status(403).json({ error: 'Forbidden: Invalid client secret' });
    }
    return next();
  };

  app.get(['/health', '/healthz'], (_req, res) => {
    res.json({
      status: 'ok',
      model: modelId,
      vertexLocation: location,
    });
  });

  app.post('/generateQuerySummary', verifyClientSecret, async (req, res) => {
    const { query, description, nextStepsInstructions } = req.body ?? {};
    if (!query || typeof query !== 'object' || typeof query.title !== 'string') {
      return res.status(400).json({ error: 'Invalid request: query with title is required.' });
    }

    const safeInstructions = sanitizeInstruction(nextStepsInstructions);
    const safeDescription = sanitizeInstruction(description);
    const fields = Array.isArray(query.queryBody?.fields)
      ? query.queryBody.fields.join(', ')
      : String(query.queryBody?.fields ?? '');
    const rows = Array.isArray(query.queryData) ? query.queryData.slice(0, 100) : [];

    const prompt = [
      `Dashboard Context: ${safeDescription || 'General business performance dashboard'}`,
      `Analysis Style / Guidance: ${safeInstructions || 'Highlight notable trends, anomalies, and operational takeaways.'}`,
      `Tile Title: ${query.title}`,
      query.note_text ? `Tile Note: ${String(query.note_text).slice(0, 1000)}` : '',
      `Queried Fields: ${fields}`,
      `Result Rows (${rows.length} rows JSON): ${JSON.stringify(rows)}`,
    ]
      .filter(Boolean)
      .join('\n');

    const thinkingBudget = resolveThinkingBudget(
      req.body?.thinkingBudget,
      defaultThinkingBudget
    );
    const config = {
      systemInstruction: [
        'You are a principal business intelligence analyst summarizing a single Looker dashboard tile.',
        'Ground every number, trend, entity name, and percentage strictly in the provided Result Rows.',
        'Never refer to row indices (e.g., "row 3"); always cite actual entity, category, or date values.',
        'Format output in clean GitHub-Flavored Markdown starting with `### <Tile Title>`, followed by a concise `>` blockquote headline takeaway and 2-4 crisp bullet points covering metrics, anomalies, and operational implications.',
      ].join(' '),
    };
    if (typeof thinkingBudget === 'number') {
      config.thinkingConfig = { thinkingBudget };
    }

    try {
      const response = await getAiClient().models.generateContent({
        model: tileModelId,
        contents: prompt,
        config,
      });

      const summary = response.text?.trim() || '';
      writeStructuredLog('INFO', 'Generated tile query summary', {
        endpoint: '/generateQuerySummary',
        model: tileModelId,
        tileTitle: query.title,
        usageMetadata: response.usageMetadata ?? null,
      });

      return res.json({
        summary,
        title: query.title,
        usage: response.usageMetadata ?? null,
      });
    } catch (err) {
      writeStructuredLog('ERROR', 'Failed in /generateQuerySummary', {
        endpoint: '/generateQuerySummary',
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({ error: 'Failed to generate tile summary.' });
    }
  });

  app.post('/generateSummary', verifyClientSecret, async (req, res) => {
    const { querySummaries, nextStepsInstructions, description } = req.body ?? {};
    const includeNextSteps =
      typeof req.body?.includeNextSteps === 'boolean' ? req.body.includeNextSteps : true;
    if (
      !Array.isArray(querySummaries) ||
      querySummaries.length === 0 ||
      querySummaries.length > MAX_QUERIES_PER_REQUEST
    ) {
      return res.status(400).json({
        error: `Invalid request: querySummaries must be a non-empty array (max ${MAX_QUERIES_PER_REQUEST}).`,
      });
    }

    const normalizedSummaries = querySummaries
      .map((item) => (typeof item === 'string' ? item : item?.summary || JSON.stringify(item)))
      .filter(Boolean);
    const safeInstructions = sanitizeInstruction(nextStepsInstructions);
    const safeDescription = sanitizeInstruction(description);
    const defaultFocus = includeNextSteps
      ? 'Executive summary with data-backed operational next steps.'
      : 'Concise executive synthesis and high-signal quantitative key findings.';

    const prompt = [
      `Dashboard Context: ${safeDescription || 'Looker Business Dashboard'}`,
      `Analysis Persona / Focus: ${safeInstructions || defaultFocus}`,
      'Synthesize all tile summaries below into a cohesive cross-dashboard executive brief.',
      'Cite concrete entity names, locations, segments, and metric values from the tile findings. Never invent metrics not supported by the tile summaries.',
      '',
      '--- TILE SUMMARIES ---',
      normalizedSummaries.join('\n\n---\n\n'),
    ].join('\n');

    const schemaProperties = {
      executiveOverview: {
        type: Type.STRING,
        description:
          '2-4 sentence executive synthesis connecting cross-tile performance, drivers, and risks.',
      },
      keyHighlights: {
        type: Type.ARRAY,
        description: '3-5 high-signal quantitative findings across the dashboard.',
        items: {
          type: Type.OBJECT,
          properties: {
            headline: { type: Type.STRING },
            detail: { type: Type.STRING },
            impact: {
              type: Type.STRING,
              enum: ['positive', 'negative', 'neutral'],
            },
          },
          required: ['headline', 'detail', 'impact'],
        },
      },
      ...(includeNextSteps
        ? {
            recommendations: {
              type: Type.ARRAY,
              description: '3-5 actionable operational or analytical next steps.',
              items: {
                type: Type.OBJECT,
                properties: {
                  action: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                  priority: {
                    type: Type.STRING,
                    enum: ['high', 'medium'],
                  },
                },
                required: ['action', 'rationale', 'priority'],
              },
            },
          }
        : {}),
    };

    const requiredFields = includeNextSteps
      ? ['executiveOverview', 'keyHighlights', 'recommendations']
      : ['executiveOverview', 'keyHighlights'];

    const thinkingBudget = resolveThinkingBudget(
      req.body?.thinkingBudget,
      defaultThinkingBudget
    );
    const config = {
      systemInstruction: includeNextSteps
        ? 'You are an executive analytics advisor synthesizing Looker dashboard tile summaries into a concise, decision-ready executive brief with concrete, prioritized next steps.'
        : 'You are an executive analytics advisor synthesizing Looker dashboard tile summaries into a concise, decision-ready executive overview and high-signal quantitative key findings. Do not include next-step recommendations.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: schemaProperties,
        required: requiredFields,
      },
    };
    if (typeof thinkingBudget === 'number') {
      config.thinkingConfig = { thinkingBudget };
    }

    try {
      const response = await getAiClient().models.generateContent({
        model: modelId,
        contents: prompt,
        config,
      });

      const parsed = JSON.parse(response.text || '{}');
      const structured = {
        executiveOverview:
          typeof parsed.executiveOverview === 'string' ? parsed.executiveOverview : '',
        keyHighlights: Array.isArray(parsed.keyHighlights) ? parsed.keyHighlights : [],
        recommendations:
          includeNextSteps && Array.isArray(parsed.recommendations)
            ? parsed.recommendations
            : [],
      };
      const markdown = buildExecutiveMarkdown(structured);

      writeStructuredLog('INFO', 'Generated executive dashboard summary', {
        endpoint: '/generateSummary',
        model: modelId,
        tileCount: normalizedSummaries.length,
        includeNextSteps,
        usageMetadata: response.usageMetadata ?? null,
      });

      return res.json({
        summary: markdown,
        structured,
        usage: response.usageMetadata ?? null,
      });
    } catch (err) {
      writeStructuredLog('ERROR', 'Failed in /generateSummary', {
        endpoint: '/generateSummary',
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({ error: 'Failed to generate dashboard summary.' });
    }
  });

  app.post('/generateQuerySuggestions', verifyClientSecret, async (req, res) => {
    const { querySummaries, nextStepsInstructions } = req.body ?? {};
    if (!Array.isArray(querySummaries) || querySummaries.length === 0) {
      return res.status(400).json({
        error: 'Invalid request: querySummaries must be a non-empty array.',
      });
    }

    const safeInstructions = sanitizeInstruction(nextStepsInstructions);
    const normalizedSummaries = querySummaries
      .map((item) => (typeof item === 'string' ? item : item?.summary || JSON.stringify(item)))
      .join('\n\n');

    const prompt = [
      'Generate 3 natural-language follow-up analytical questions a user can ask Looker Conversational Analytics to investigate root causes or act on the findings below.',
      'Every question MUST include a concrete time window (default to "in the last 30 days" if no more specific window applies) and reference specific dimensions/entities surfaced in the summary without repeating existing dashboard tiles.',
      `Focus Guidance: ${safeInstructions || 'Root-cause drilldowns and operational follow-ups.'}`,
      '',
      '--- CURRENT FINDINGS ---',
      normalizedSummaries,
    ].join('\n');

    const thinkingBudget = resolveThinkingBudget(
      req.body?.thinkingBudget,
      defaultThinkingBudget
    );
    const config = {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            querySuggestion: {
              type: Type.STRING,
              description:
                'Natural-language analytical question including an explicit time filter.',
            },
            rationale: {
              type: Type.STRING,
              description: 'Short 1-sentence reason why this follow-up matters.',
            },
            category: {
              type: Type.STRING,
              description: 'Short badge category such as Anomaly, Root Cause, Cohort, or Forecast.',
            },
          },
          required: ['querySuggestion', 'rationale', 'category'],
        },
      },
    };
    if (typeof thinkingBudget === 'number') {
      config.thinkingConfig = { thinkingBudget };
    }

    try {
      const response = await getAiClient().models.generateContent({
        model: modelId,
        contents: prompt,
        config,
      });

      const suggestions = JSON.parse(response.text || '[]');
      writeStructuredLog('INFO', 'Generated follow-up query suggestions', {
        endpoint: '/generateQuerySuggestions',
        model: modelId,
        suggestionCount: Array.isArray(suggestions) ? suggestions.length : 0,
        usageMetadata: response.usageMetadata ?? null,
      });

      return res.json({
        suggestions,
        usage: response.usageMetadata ?? null,
      });
    } catch (err) {
      writeStructuredLog('ERROR', 'Failed in /generateQuerySuggestions', {
        endpoint: '/generateQuerySuggestions',
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({ error: 'Failed to generate query suggestions.' });
    }
  });

  app.post('/generateExecutivePackage', verifyClientSecret, async (req, res) => {
    const {
      dashboardTitle,
      dashboardDescription,
      prompt: customPrompt,
      tiles,
      thinkingBudget: reqBudget,
    } = req.body ?? {};
    const includeNextSteps =
      typeof req.body?.includeNextSteps === 'boolean' ? req.body.includeNextSteps : true;
    const includeSuggestions =
      typeof req.body?.includeSuggestions === 'boolean' ? req.body.includeSuggestions : true;

    if (!Array.isArray(tiles) || tiles.length === 0 || tiles.length > MAX_QUERIES_PER_REQUEST) {
      return res.status(400).json({
        error: `Invalid request: tiles must be a non-empty array (max ${MAX_QUERIES_PER_REQUEST}).`,
      });
    }

    const safeTitle = sanitizeInstruction(dashboardTitle);
    const safeDescription = sanitizeInstruction(dashboardDescription);
    const safeInstructions = sanitizeInstruction(customPrompt);
    const defaultFocus = includeNextSteps
      ? 'Comprehensive executive briefing connecting KPI performance, operational drivers, and strategic next steps.'
      : 'Concise executive synthesis and high-signal quantitative key findings.';

    const formattedTiles = tiles.map((t, idx) => {
      const tileTitle =
        typeof t.title === 'string' && t.title.trim() ? t.title.trim() : `Tile ${idx + 1}`;
      const noteText = typeof t.note_text === 'string' ? t.note_text.slice(0, 500) : '';
      const rows = Array.isArray(t.data) ? t.data.slice(0, 25) : [];
      return {
        title: tileTitle,
        context: [
          `[Tile ${idx + 1}] Title: ${tileTitle}`,
          noteText ? `Tile Note: ${noteText}` : '',
          `Data (${rows.length} sample rows JSON): ${JSON.stringify(rows)}`,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    });

    const promptText = [
      `Dashboard Title: ${safeTitle || 'Looker Dashboard'}`,
      `Dashboard Context: ${safeDescription || 'Business performance dashboard'}`,
      `Analysis Focus: ${safeInstructions || defaultFocus}`,
      '',
      'You are provided with all data tiles on this dashboard. Analyze the entire dashboard dataset in a single pass to produce a unified, decision-ready executive reporting package.',
      'Ground every headline number, percentage, date, and product ID strictly in the provided Tile Datasets.',
      'Never invent metrics not present in the data.',
      '',
      '--- TILE DATASETS ---',
      formattedTiles.map((t) => t.context).join('\n\n'),
    ].join('\n');

    const schemaProperties = {
      executiveOverview: {
        type: Type.STRING,
        description:
          '2-4 sentence executive synthesis connecting top-line metrics, trends, and bottlenecks across all tiles.',
      },
      keyHighlights: {
        type: Type.ARRAY,
        description: '3-5 high-signal quantitative findings across the dashboard.',
        items: {
          type: Type.OBJECT,
          properties: {
            headline: { type: Type.STRING },
            detail: { type: Type.STRING },
            impact: {
              type: Type.STRING,
              enum: ['positive', 'negative', 'neutral'],
            },
          },
          required: ['headline', 'detail', 'impact'],
        },
      },
      ...(includeNextSteps
        ? {
            recommendations: {
              type: Type.ARRAY,
              description: '2-4 actionable operational or strategic next steps.',
              items: {
                type: Type.OBJECT,
                properties: {
                  action: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                  priority: {
                    type: Type.STRING,
                    enum: ['high', 'medium'],
                  },
                },
                required: ['action', 'rationale', 'priority'],
              },
            },
          }
        : {}),
      ...(includeSuggestions
        ? {
            querySuggestions: {
              type: Type.ARRAY,
              description:
                '3 natural-language analytical follow-up questions for Looker Conversational Analytics with explicit timeframes.',
              items: {
                type: Type.OBJECT,
                properties: {
                  querySuggestion: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                  category: { type: Type.STRING },
                },
                required: ['querySuggestion', 'rationale', 'category'],
              },
            },
          }
        : {}),
      tileSummaries: {
        type: Type.ARRAY,
        description:
          'Individual breakdown summaries for every provided tile, matching the order received.',
        items: {
          type: Type.OBJECT,
          properties: {
            tileTitle: { type: Type.STRING },
            headlineTakeaway: {
              type: Type.STRING,
              description: 'Single-sentence core takeaway or status for this tile.',
            },
            bulletPoints: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '2-4 crisp bullet points citing concrete numbers, trends, or anomalies.',
            },
          },
          required: ['tileTitle', 'headlineTakeaway', 'bulletPoints'],
        },
      },
    };

    const requiredFields = [
      'executiveOverview',
      'keyHighlights',
      'tileSummaries',
      ...(includeNextSteps ? ['recommendations'] : []),
      ...(includeSuggestions ? ['querySuggestions'] : []),
    ];

    const thinkingBudget = resolveThinkingBudget(reqBudget, defaultThinkingBudget);
    const config = {
      systemInstruction:
        'You are a staff business intelligence analyst summarizing an entire Looker dashboard in a single structured pass. Every statement must be backed by the tile data.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: schemaProperties,
        required: requiredFields,
      },
    };
    if (typeof thinkingBudget === 'number') {
      config.thinkingConfig = { thinkingBudget };
    }

    try {
      const response = await getAiClient().models.generateContent({
        model: modelId,
        contents: promptText,
        config,
      });

      const parsed = JSON.parse(response.text || '{}');
      const structured = {
        executiveOverview:
          typeof parsed.executiveOverview === 'string' ? parsed.executiveOverview : '',
        keyHighlights: Array.isArray(parsed.keyHighlights) ? parsed.keyHighlights : [],
        recommendations:
          includeNextSteps && Array.isArray(parsed.recommendations)
            ? parsed.recommendations
            : [],
      };
      const markdown = buildExecutiveMarkdown(structured);

      const tileSummaries = (Array.isArray(parsed.tileSummaries) ? parsed.tileSummaries : []).map(
        (ts, idx) => {
          const fallbackTitle = formattedTiles[idx]?.title || `Tile ${idx + 1}`;
          const safeItem = {
            tileTitle:
              typeof ts.tileTitle === 'string' && ts.tileTitle.trim()
                ? ts.tileTitle.trim()
                : fallbackTitle,
            headlineTakeaway:
              typeof ts.headlineTakeaway === 'string' ? ts.headlineTakeaway : '',
            bulletPoints: Array.isArray(ts.bulletPoints) ? ts.bulletPoints : [],
          };
          return {
            title: safeItem.tileTitle,
            markdown: buildTileMarkdown(safeItem),
            headlineTakeaway: safeItem.headlineTakeaway,
            bulletPoints: safeItem.bulletPoints,
          };
        }
      );

      const suggestions =
        includeSuggestions && Array.isArray(parsed.querySuggestions)
          ? parsed.querySuggestions
          : [];

      writeStructuredLog('INFO', 'Generated single-pass executive package', {
        endpoint: '/generateExecutivePackage',
        model: modelId,
        tileCount: formattedTiles.length,
        includeNextSteps,
        includeSuggestions,
        usageMetadata: response.usageMetadata ?? null,
      });

      return res.json({
        summary: markdown,
        structured,
        tileSummaries,
        suggestions,
        usage: response.usageMetadata ?? null,
      });
    } catch (err) {
      writeStructuredLog('ERROR', 'Failed in /generateExecutivePackage', {
        endpoint: '/generateExecutivePackage',
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({ error: 'Failed to generate executive package.' });
    }
  });

  app.post('/slack/oauth-exchange', verifyClientSecret, async (req, res) => {
    const { code, redirectUri } = req.body ?? {};
    if (typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'Invalid request: authorization code is required.' });
    }
    if (!slackClientId || !slackClientSecret) {
      return res.status(503).json({
        error: 'Slack OAuth is not configured on the backend service.',
      });
    }

    try {
      const params = new URLSearchParams({
        client_id: slackClientId,
        client_secret: slackClientSecret,
        code: code.trim(),
      });
      if (typeof redirectUri === 'string' && redirectUri.trim()) {
        params.set('redirect_uri', redirectUri.trim());
      }

      const slackResp = await fetchImpl('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const data = await slackResp.json();
      if (!slackResp.ok || !data.ok) {
        writeStructuredLog('WARNING', 'Slack OAuth token exchange rejected', {
          endpoint: '/slack/oauth-exchange',
          slackError: data.error ?? 'unknown_error',
        });
        return res.status(502).json({ error: 'Slack token exchange failed.' });
      }

      return res.json({
        access_token: data.authed_user?.access_token || data.access_token,
      });
    } catch (err) {
      writeStructuredLog('ERROR', 'Failed in /slack/oauth-exchange', {
        endpoint: '/slack/oauth-exchange',
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({ error: 'Slack OAuth exchange error.' });
    }
  });

  return app;
}
