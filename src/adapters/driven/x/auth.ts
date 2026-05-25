import { CodeChallengeMethod, generateCodeVerifier, generateState, OAuth2Client } from "arctic";
import type { Config } from "../../../config.ts";
import type { SecretStore } from "../../../ports/driven/secret-store.ts";

const AUTHORIZATION_ENDPOINT = "https://x.com/i/oauth2/authorize";
const TOKEN_ENDPOINT = "https://api.x.com/2/oauth2/token";

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

const createClient = (config: Config) =>
  new OAuth2Client(config.x.clientId, config.x.clientSecret ?? null, config.x.redirectUri);

export const startAuthorization = (config: Config) => {
  const client = createClient(config);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = client.createAuthorizationURLWithPKCE(
    AUTHORIZATION_ENDPOINT,
    state,
    CodeChallengeMethod.S256,
    codeVerifier,
    X_OAUTH_SCOPES,
  );
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
  const client = createClient(config);
  const tokens = await client.validateAuthorizationCode(TOKEN_ENDPOINT, code, codeVerifier);
  return tokensFromOAuth2(tokens);
};

const REFRESH_LEEWAY_MS = 60_000;

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
  const client = createClient(config);
  const refreshed = await client.refreshAccessToken(TOKEN_ENDPOINT, stored.refreshToken, []);
  const next = tokensFromOAuth2(refreshed);
  await secrets.put("x.oauth.tokens", JSON.stringify(next));
  return next.accessToken;
};

export const persistTokens = async (
  secrets: SecretStore,
  tokens: StoredTokens,
): Promise<void> => {
  await secrets.put("x.oauth.tokens", JSON.stringify(tokens));
};
