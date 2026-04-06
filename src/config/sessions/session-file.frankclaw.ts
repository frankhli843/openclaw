import fs from "node:fs";
import path from "node:path";

/**
 * frankclaw overlay: make transcript materialization happen before session
 * metadata is persisted, so a stored sessionFile path always points at a real
 * on-disk transcript file.
 */
export async function materializeSessionTranscriptFile(sessionFile: string): Promise<void> {
  const filePath = sessionFile.trim();
  if (!filePath) {
    throw new Error("session transcript path is empty");
  }

  await fs.promises.mkdir(path.dirname(filePath), {
    recursive: true,
    mode: 0o700,
  });

  const handle = await fs.promises.open(filePath, "a", 0o600);
  await handle.close();
}
