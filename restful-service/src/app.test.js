import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { createApp, DEFAULT_MODEL_ID, safeCompareSecret } from './app.js';

let activeServers = [];

afterEach(async () => {
  await Promise.all(
    activeServers.map(
      (srv) =>
        new Promise((resolve) => {
          srv.close(() => resolve());
        })
    )
  );
  activeServers = [];
});

async function startTestServer(appOptions) {
  const app = createApp(appOptions);
  const server = http.createServer(app);
  activeServers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

describe('safeCompareSecret & fail-closed authentication', () => {
  it('rejects empty or non-string secrets (prevents undefined === undefined bypass)', () => {
    assert.equal(safeCompareSecret(undefined, undefined), false);
    assert.equal(safeCompareSecret('', ''), false);
    assert.equal(safeCompareSecret('secret', ''), false);
    assert.equal(safeCompareSecret('', 'secret'), false);
    assert.equal(safeCompareSecret('wrong', 'secret'), false);
    assert.equal(safeCompareSecret('correct-secret', 'correct-secret'), true);
  });

  it('fails closed with 403 when server GENAI_CLIENT_SECRET is unset', async () => {
    const baseUrl = await startTestServer({
      storedClientSecret: '',
      aiClient: { models: { generateContent: async () => ({ text: 'ok' }) } },
    });

    const resp = await fetch(`${baseUrl}/generateSummary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ querySummaries: ['tile 1'] }),
    });
    assert.equal(resp.status, 403);
  });
});

describe('Vertex AI summarization endpoints', () => {
  it('exposes /health and /healthz with default gemini-3.5-flash-lite model', async () => {
    const baseUrl = await startTestServer({
      storedClientSecret: 'test-secret',
      aiClient: { models: { generateContent: async () => ({ text: '' }) } },
    });

    for (const path of ['/health', '/healthz']) {
      const resp = await fetch(`${baseUrl}${path}`);
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.status, 'ok');
      assert.equal(body.model, DEFAULT_MODEL_ID);
    }
  });

  it('generates per-tile query summaries via @google/genai with thinkingBudget: 0', async () => {
    let capturedCall = null;
    const mockAi = {
      models: {
        generateContent: async (req) => {
          capturedCall = req;
          return {
            text: '### Revenue by Region\n> North America led growth at $1.4M (+18% MoM).\n* Strong enterprise expansion in Q3.',
            usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 42, totalTokenCount: 162 },
          };
        },
      },
    };

    const baseUrl = await startTestServer({
      storedClientSecret: 'test-secret',
      aiClient: mockAi,
    });

    const resp = await fetch(`${baseUrl}/generateQuerySummary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Genai-Client-Secret': 'test-secret',
      },
      body: JSON.stringify({
        query: {
          title: 'Revenue by Region',
          note_text: 'Excludes internal transfers',
          queryBody: { fields: ['orders.region', 'orders.total_revenue'] },
          queryData: [{ 'orders.region': 'North America', 'orders.total_revenue': 1400000 }],
        },
        description: 'Executive Revenue Dashboard',
        nextStepsInstructions: 'Focus on top growth drivers',
      }),
    });

    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(capturedCall.model, 'gemini-3.5-flash-lite');
    assert.equal(capturedCall.config?.thinkingConfig?.thinkingBudget, 0);
    assert.match(data.summary, /Revenue by Region/);
    assert.equal(data.usage.totalTokenCount, 162);
  });

  it('generates structured + Markdown executive brief on /generateSummary', async () => {
    const mockStructured = {
      executiveOverview: 'Total revenue reached $2.8M, driven by North America (+18%).',
      keyHighlights: [
        {
          headline: 'North America Outperformance',
          detail: 'Contributed 50% of total revenue ($1.4M).',
          impact: 'positive',
        },
      ],
      recommendations: [
        {
          action: 'Reallocate Q4 field marketing budget toward EMEA enterprise accounts',
          rationale: 'EMEA conversion dipped 4% despite steady pipeline.',
          priority: 'high',
        },
      ],
    };

    const baseUrl = await startTestServer({
      storedClientSecret: 'test-secret',
      aiClient: {
        models: {
          generateContent: async () => ({
            text: JSON.stringify(mockStructured),
            usageMetadata: { totalTokenCount: 250 },
          }),
        },
      },
    });

    const resp = await fetch(`${baseUrl}/generateSummary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_secret: 'test-secret',
        querySummaries: ['### Revenue by Region\n* North America $1.4M'],
        nextStepsInstructions: 'Executive style',
      }),
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.structured.executiveOverview, mockStructured.executiveOverview);
    assert.match(body.summary, /## Executive Overview/);
    assert.match(body.summary, /## Recommended Next Steps/);
  });

  it('omits recommendations from responseSchema and output when includeNextSteps is false', async () => {
    let capturedCall = null;
    const baseUrl = await startTestServer({
      storedClientSecret: 'test-secret',
      aiClient: {
        models: {
          generateContent: async (req) => {
            capturedCall = req;
            return {
              text: JSON.stringify({
                executiveOverview: 'Revenue grew 18% YoY across North America.',
                keyHighlights: [
                  {
                    headline: 'Margin Expansion',
                    detail: 'Gross margin increased 220 bps.',
                    impact: 'positive',
                  },
                ],
              }),
              usageMetadata: { totalTokenCount: 180 },
            };
          },
        },
      },
    });

    const resp = await fetch(`${baseUrl}/generateSummary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Genai-Client-Secret': 'test-secret',
      },
      body: JSON.stringify({
        querySummaries: ['### Revenue by Region\n* North America $1.4M'],
        nextStepsInstructions: 'Executive style',
        includeNextSteps: false,
      }),
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        capturedCall.config.responseSchema.properties,
        'recommendations'
      ),
      false
    );
    assert.deepEqual(capturedCall.config.responseSchema.required, [
      'executiveOverview',
      'keyHighlights',
    ]);
    assert.deepEqual(body.structured.recommendations, []);
    assert.doesNotMatch(body.summary, /## Recommended Next Steps/);
  });

  it('generates typed JSON array on /generateQuerySuggestions', async () => {
    const mockSuggestions = [
      {
        querySuggestion: 'Break down EMEA enterprise conversion rate by channel in the last 30 days',
        rationale: 'Identifies the source of the 4% EMEA conversion dip.',
        category: 'Root Cause',
      },
    ];

    const baseUrl = await startTestServer({
      storedClientSecret: 'test-secret',
      aiClient: {
        models: {
          generateContent: async () => ({
            text: JSON.stringify(mockSuggestions),
          }),
        },
      },
    });

    const resp = await fetch(`${baseUrl}/generateQuerySuggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_secret: 'test-secret',
        querySummaries: ['EMEA conversion dipped 4%'],
        nextStepsInstructions: 'Analyst style',
      }),
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(Array.isArray(body.suggestions), true);
    assert.equal(body.suggestions[0].category, 'Root Cause');
  });

  it('generates unified single-pass executive package on /generateExecutivePackage with thinkingBudget: 0', async () => {
    let capturedCall = null;
    const mockPackage = {
      executiveOverview: 'Overall business revenue reached $10.8M with strong Q4 trajectory.',
      keyHighlights: [
        { headline: 'Top-line Scale', detail: 'Gross sales hit $10.8M across 125k orders.', impact: 'positive' },
      ],
      recommendations: [
        { action: 'Expedite 25k processing orders', rationale: 'Avoids order cancellation escalation.', priority: 'high' },
      ],
      querySuggestions: [
        { querySuggestion: 'What are the main cancellation reasons in the last 30 days?', rationale: 'Reduces leakage', category: 'Root Cause' },
      ],
      tileSummaries: [
        {
          tileTitle: 'Total Gross Revenue',
          headlineTakeaway: 'Revenue stands at $10.8M.',
          bulletPoints: ['Driven by consistent order volumes.', 'High average order value.'],
        },
      ],
    };

    const baseUrl = await startTestServer({
      storedClientSecret: 'test-secret',
      aiClient: {
        models: {
          generateContent: async (req) => {
            capturedCall = req;
            return {
              text: JSON.stringify(mockPackage),
              usageMetadata: { promptTokenCount: 250, candidatesTokenCount: 150, totalTokenCount: 400 },
            };
          },
        },
      },
    });

    const resp = await fetch(`${baseUrl}/generateExecutivePackage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_secret: 'test-secret',
        dashboardTitle: 'Executive Orders',
        dashboardDescription: 'Orders overview',
        prompt: 'Analyze key drivers',
        tiles: [
          {
            title: 'Total Gross Revenue',
            query: 'sandbox/orders',
            data: [{ total_sales: 10800000 }],
          },
        ],
        includeNextSteps: true,
        includeSuggestions: true,
      }),
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(capturedCall.model, 'gemini-3.5-flash-lite');
    assert.equal(capturedCall.config?.thinkingConfig?.thinkingBudget, 0);
    assert.equal(body.structured.executiveOverview, mockPackage.executiveOverview);
    assert.equal(body.structured.keyHighlights.length, 1);
    assert.equal(body.structured.recommendations.length, 1);
    assert.equal(body.suggestions.length, 1);
    assert.equal(body.tileSummaries.length, 1);
    assert.equal(body.tileSummaries[0].title, 'Total Gross Revenue');
    assert.match(body.tileSummaries[0].markdown, /Revenue stands at \$10\.8M/);
    assert.match(body.summary, /## Executive Overview/);
    assert.match(body.summary, /## Recommended Next Steps/);
  });

  it('exchanges Slack OAuth code server-side without exposing client_secret', async () => {
    const baseUrl = await startTestServer({
      storedClientSecret: 'test-secret',
      slackClientId: 'slack-id',
      slackClientSecret: 'slack-secret',
      aiClient: { models: { generateContent: async () => ({ text: '{}' }) } },
      fetchImpl: async (url, init) => {
        assert.equal(url, 'https://slack.com/api/oauth.v2.access');
        assert.match(init.body, /client_secret=slack-secret/);
        return {
          ok: true,
          json: async () => ({ ok: true, access_token: 'xoxb-server-exchanged' }),
        };
      },
    });

    const resp = await fetch(`${baseUrl}/slack/oauth-exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_secret: 'test-secret', code: 'oauth-code-123' }),
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.access_token, 'xoxb-server-exchanged');
  });
});
