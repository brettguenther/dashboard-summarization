import path from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const PUBLIC_ENV_KEYS = [
  'RESTFUL_WEBSERVICE',
  'GOOGLE_CLIENT_ID',
  'SLACK_CLIENT_ID',
  'SPACE_ID',
  'CHANNEL_ID',
  'LOOKER_AGENT_ID',
] as const;

/**
 * Inlines emitted CSS assets directly into `dashboard_summarization.js` via safe DOM `<style>`
 * creation (`textContent`), ensuring Looker `file: "dashboard_summarization.js"` deployments
 * are 100% self-contained in a single file.
 */
function inlineCssIntoExtensionBundle(): Plugin {
  return {
    name: 'inline-css-into-extension-bundle',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const cssParts: string[] = [];
      for (const [fileName, item] of Object.entries(bundle)) {
        if (fileName.endsWith('.css') && item.type === 'asset') {
          cssParts.push(String(item.source));
          delete bundle[fileName];
        }
      }
      if (cssParts.length === 0) return;

      const combinedCss = JSON.stringify(cssParts.join('\n'));
      const injector = `(function(){if(typeof document!=='undefined'){var s=document.createElement('style');s.setAttribute('data-looker-ext','dashboard-summarization');s.textContent=${combinedCss};document.head.appendChild(s);}})();\n`;

      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk' && item.isEntry) {
          item.code = injector + item.code;
        }
      }
    },
  };
}

/**
 * Serves `/dashboard_summarization.js` during `vite` local development as a classic `<script>`
 * bootstrapper so Looker's `<script src="https://localhost:3000/dashboard_summarization.js">`
 * loader mounts Vite HMR + `/src/index.tsx` cleanly.
 */
function lookerDevEntrypointMiddleware(): Plugin {
  return {
    name: 'looker-dev-entrypoint-middleware',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0] === '/dashboard_summarization.js') {
          const host = req.headers.host || 'localhost:3000';
          const origin = `https://${host}`;
          const bootstrap = [
            '(function() {',
            `  window.__vite_plugin_react_preamble_installed__ = true;`,
            `  var client = document.createElement('script');`,
            `  client.type = 'module';`,
            `  client.src = '${origin}/@vite/client';`,
            `  document.head.appendChild(client);`,
            `  var entry = document.createElement('script');`,
            `  entry.type = 'module';`,
            `  entry.src = '${origin}/src/index.tsx';`,
            `  document.head.appendChild(entry);`,
            '})();',
          ].join('\n');

          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(bootstrap);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const rawEnv = loadEnv(mode, process.cwd(), '');
  const isDev = mode === 'development';
  const isTest = mode === 'test' || Boolean(process.env.VITEST);

  const safeEnv: Record<string, string> = {};
  for (const key of PUBLIC_ENV_KEYS) {
    safeEnv[key] = rawEnv[key] || '';
  }
  // Never bundle GENAI_CLIENT_SECRET into production artifacts; Looker resolves
  // extensionSDK.createSecretKeyTag("genai_client_secret") server-side via ExternalApiProxy.
  const devClientSecret = isDev ? rawEnv.GENAI_CLIENT_SECRET || '' : '';

  const defineMap: Record<string, string> = {
    'process.env.NODE_ENV': JSON.stringify(mode),
    __APP_CONFIG__: JSON.stringify({
      ...safeEnv,
      DEV_GENAI_CLIENT_SECRET: devClientSecret,
      IS_DEV: isDev,
    }),
  };

  return {
    plugins: [
      react(),
      ...(isTest ? [] : [basicSsl(), lookerDevEntrypointMiddleware(), inlineCssIntoExtensionBundle()]),
    ],
    resolve: {
      alias: isDev
        ? [
            {
              // @looker/sdk@26.22.0 lib/esm/index.js re-exports the TypeScript-only interface
              // `ILooker40SDK` as a value export, breaking Vite dev esbuild pre-bundling.
              find: /^@looker\/sdk$/,
              replacement: path.resolve(__dirname, 'node_modules/@looker/sdk/lib/index.js'),
            },
          ]
        : [],
    },
    define: defineMap,
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: true,
      cors: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      cssCodeSplit: false,
      lib: {
        entry: path.resolve(__dirname, 'src/index.tsx'),
        name: 'LookerDashboardSummarization',
        formats: ['iife'],
        fileName: () => 'dashboard_summarization.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
