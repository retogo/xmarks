import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SecretKey, SecretStore } from "../../../ports/driven/secret-store.ts";

export const createLocalSecretStore = (homeDir: string): SecretStore => {
  const fileFor = (key: SecretKey): string => join(homeDir, "secrets", `${key}.txt`);

  return {
    async get(key) {
      const file = Bun.file(fileFor(key));
      if (!(await file.exists())) return undefined;
      return (await file.text()).trim();
    },
    async put(key, value) {
      await mkdir(join(homeDir, "secrets"), { recursive: true });
      await Bun.write(fileFor(key), value);
    },
  };
};
