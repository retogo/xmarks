import type { Config } from "../../../config.ts";
import type { SecretStore } from "../../../ports/driven/secret-store.ts";
import { bootstrapGcpCredentials } from "./bootstrap.ts";
import { createLocalSecretStore } from "./local.ts";
import { createGsmSecretStore } from "./gsm.ts";

export const createSecretStore = (config: Config): SecretStore => {
  if (config.secrets.backend === "gsm") {
    if (!config.secrets.gsm.project) {
      throw new Error("SECRET_BACKEND=gsm requires GOOGLE_CLOUD_PROJECT");
    }
    bootstrapGcpCredentials();
    return createGsmSecretStore({
      project: config.secrets.gsm.project,
      prefix: config.secrets.gsm.prefix,
    });
  }
  return createLocalSecretStore(config.secrets.localHome);
};
