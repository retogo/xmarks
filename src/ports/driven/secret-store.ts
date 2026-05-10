export type SecretKey =
  | "x.oauth.tokens"
  | "x.oauth.client_id"
  | "x.oauth.client_secret";

export interface SecretStore {
  get(key: SecretKey): Promise<string | undefined>;
  put(key: SecretKey, value: string): Promise<void>;
}
