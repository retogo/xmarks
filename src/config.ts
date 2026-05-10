import { homedir } from "node:os";
import { join } from "node:path";

export type SecretBackend = "local" | "gsm";

export type Config = {
  x: {
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
  };
  xai?: {
    apiKey: string;
    model: string;
  };
  secrets: {
    backend: SecretBackend;
    localHome: string;
    gsm: {
      project?: string;
      prefix: string;
    };
  };
};

const required = (name: string): string => {
  const value = process.env[name];
  if (!value || value.length === 0) throw new Error(`Missing env: ${name}`);
  return value;
};

const optional = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
};

const resolveLocalHome = (): string => {
  const explicit = optional("XMARKS_HOME");
  if (explicit) return explicit;
  const xdg = optional("XDG_CONFIG_HOME") ?? join(homedir(), ".config");
  return join(xdg, "xmarks");
};

export const loadConfig = (): Config => {
  const backend = (optional("SECRET_BACKEND") ?? "local") as SecretBackend;
  if (backend !== "local" && backend !== "gsm") {
    throw new Error(`Invalid SECRET_BACKEND: ${backend}`);
  }
  const xaiKey = optional("XAI_API_KEY");
  return {
    x: {
      clientId: required("X_CLIENT_ID"),
      clientSecret: optional("X_CLIENT_SECRET"),
      redirectUri: optional("X_OAUTH_REDIRECT_URI") ?? "http://127.0.0.1:8787/callback",
    },
    xai: xaiKey
      ? { apiKey: xaiKey, model: optional("XAI_MODEL") ?? "grok-4-fast-non-reasoning" }
      : undefined,
    secrets: {
      backend,
      localHome: resolveLocalHome(),
      gsm: {
        project: optional("GOOGLE_CLOUD_PROJECT"),
        prefix: optional("GSM_SECRET_PREFIX") ?? "xmarks",
      },
    },
  };
};
