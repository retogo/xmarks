import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import type { SecretKey, SecretStore } from "../../../ports/driven/secret-store.ts";

export type GsmOptions = {
  project: string;
  prefix: string;
};

export const createGsmSecretStore = ({ project, prefix }: GsmOptions): SecretStore => {
  const client = new SecretManagerServiceClient();
  const secretName = (key: SecretKey) => `${prefix}-${key.replaceAll(".", "-")}`;
  const parent = `projects/${project}`;
  const resource = (key: SecretKey) => `${parent}/secrets/${secretName(key)}`;

  return {
    async get(key) {
      try {
        const [version] = await client.accessSecretVersion({
          name: `${resource(key)}/versions/latest`,
        });
        const payload = version.payload?.data;
        if (!payload) return undefined;
        return Buffer.from(payload as Uint8Array).toString("utf8").trim();
      } catch (err) {
        const code = (err as { code?: number | string }).code;
        // 5 = NOT_FOUND in gRPC
        if (code === 5 || code === "5") return undefined;
        throw err;
      }
    },
    async put(key, value) {
      const name = secretName(key);
      try {
        await client.createSecret({
          parent,
          secretId: name,
          secret: { replication: { automatic: {} } },
        });
      } catch (err) {
        const code = (err as { code?: number | string }).code;
        // 6 = ALREADY_EXISTS, 7 = PERMISSION_DENIED.
        // Both are expected when the secret is pre-created (e.g. by Terraform) and the SA
        // does not hold roles/secretmanager.admin or secretCreator. addSecretVersion below
        // will surface a real failure if the secret truly does not exist.
        if (code !== 6 && code !== "6" && code !== 7 && code !== "7") throw err;
      }
      const [created] = await client.addSecretVersion({
        parent: resource(key),
        payload: { data: Buffer.from(value, "utf8") },
      });
      const newVersionName = created.name;
      if (!newVersionName) return;

      const [versions] = await client.listSecretVersions({ parent: resource(key) });
      for (const v of versions) {
        if (!v.name || v.name === newVersionName) continue;
        if (v.state === "DESTROYED" || v.state === 2) continue;
        try {
          await client.destroySecretVersion({ name: v.name });
        } catch (err) {
          console.error(`[gsm] failed to destroy old version ${v.name}: ${(err as Error).message}`);
        }
      }
    },
  };
};
