export interface AppRuntimeConfig {
  RESTFUL_WEBSERVICE: string;
  GOOGLE_CLIENT_ID: string;
  SLACK_CLIENT_ID: string;
  SPACE_ID: string;
  CHANNEL_ID: string;
  LOOKER_AGENT_ID: string;
  DEV_GENAI_CLIENT_SECRET: string;
  IS_DEV: boolean;
}

declare const __APP_CONFIG__: AppRuntimeConfig | undefined;

const fallbackConfig: AppRuntimeConfig = {
  RESTFUL_WEBSERVICE: 'http://127.0.0.1:5000',
  GOOGLE_CLIENT_ID: '',
  SLACK_CLIENT_ID: '',
  SPACE_ID: '',
  CHANNEL_ID: '',
  LOOKER_AGENT_ID: '',
  DEV_GENAI_CLIENT_SECRET: '',
  IS_DEV: true,
};

export const appConfig: AppRuntimeConfig =
  typeof __APP_CONFIG__ !== 'undefined' ? __APP_CONFIG__ : fallbackConfig;
