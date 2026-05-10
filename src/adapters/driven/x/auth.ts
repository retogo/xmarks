import { generateCodeVerifier, generateState, Twitter } from "arctic";
import type { Config } from "../../../config.ts";
import type { SecretStore } from "../../../ports/driven/secret-store.ts";

export const X_OAUTH_SCOPES = [
  "tweet.read",
  "users.read",
  "like.read",
  "bookmark.read",
  "offline.access",
];

export type StoredTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

export const createTwitterClient = (config: Config) =>
  new Twitter(config.x.clientId, config.x.clientSecret ?? null, config.x.redirectUri);

export const startAuthorization = (config: Config) => {
  const client = createTwitterClient(config);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = client.createAuthorizationURL(state, codeVerifier, X_OAUTH_SCOPES);
  return { url, state, codeVerifier };
};

const tokensFromOAuth2 = (tokens: {
  accessToken: () => string;
  refreshToken: () => string;
  accessTokenExpiresAt: () => Date;
  hasRefreshToken: () => boolean;
}): StoredTokens => ({
  accessToken: tokens.accessToken(),
  refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : undefined,
  expiresAt: tokens.accessTokenExpiresAt().getTime(),
});

export const exchangeCode = async (
  config: Config,
  code: string,
  codeVerifier: string,
): Promise<StoredTokens> => {
  const client = createTwitterClient(config);
  const tokens = await client.validateAuthorizationCode(code, codeVerifier);
  return tokensFromOAuth2(tokens);
};

const REFRESH_LEEWAY_MS = 60_000;
const X_TOKEN_ENDPOINT = "https://api.x.com/2/oauth2/token";

const refreshTokens = async (config: Config, refreshToken: string): Promise<StoredTokens> => {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.x.clientId,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (config.x.clientSecret) {
    headers.Authorization = "Basic " + btoa(`${config.x.clientId}:${config.x.clientSecret}`);
  }
  const res = await fetch(X_TOKEN_ENDPOINT, { method: "POST", headers, body });
  if (!res.ok) {
    throw new Error(`X token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
};

export const loadAccessToken = async (
  config: Config,
  secrets: SecretStore,
): Promise<string> => {
  const raw = await secrets.get("x.oauth.tokens");
  if (!raw) throw new Error("X OAuth tokens not found. Run `xmarks auth` first.");
  const stored: StoredTokens = JSON.parse(raw);
  if (stored.expiresAt - REFRESH_LEEWAY_MS > Date.now()) return stored.accessToken;
  if (!stored.refreshToken) {
    throw new Error("X access token expired and no refresh token. Re-run `xmarks auth`.");
  }
  const next = await refreshTokens(config, stored.refreshToken);
  await secrets.put("x.oauth.tokens", JSON.stringify(next));
  return next.accessToken;
};

export const persistTokens = async (
  secrets: SecretStore,
  tokens: StoredTokens,
): Promise<void> => {
  await secrets.put("x.oauth.tokens", JSON.stringify(tokens));
};
