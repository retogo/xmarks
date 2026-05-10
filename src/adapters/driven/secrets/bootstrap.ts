import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let bootstrapped = false;

export const bootstrapGcpCredentials = (): void => {
  if (bootstrapped) return;
  bootstrapped = true;

  const inline = process.env.GCP_SA_KEY_JSON;
  if (!inline || inline.length === 0) return;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(inline);
  } catch (err) {
    throw new Error(`GCP_SA_KEY_JSON is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("GCP_SA_KEY_JSON must be a JSON object (service account key)");
  }

  const dir = mkdtempSync(join(tmpdir(), "xmarks-gcp-"));
  const file = join(dir, "sa.json");
  writeFileSync(file, inline, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = file;
};
