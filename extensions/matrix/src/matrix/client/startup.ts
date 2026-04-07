/**
 * Matrix client startup with a grace period.
 *
 * The Matrix SDK `client.start()` runs a long-lived sync loop that never
 * resolves on its own.  This wrapper races the start call against a grace
 * timer so the gateway can continue booting even when the sync loop hangs.
 *
 * If `client.start()` rejects during the grace window the error propagates
 * immediately.  If it rejects *after* the grace window has elapsed (late
 * failure), the optional `onError` callback is invoked instead.
 */

export const MATRIX_CLIENT_STARTUP_GRACE_MS = 10_000;

export async function startMatrixClientWithGrace(params: {
  client: { start: () => Promise<void> };
  onError?: (err: unknown) => void;
}): Promise<void> {
  const { client, onError } = params;

  let settled = false;

  const startPromise = client.start().then(
    () => {
      settled = true;
    },
    (err: unknown) => {
      if (!settled) {
        settled = true;
        throw err;
      }
      // Late failure after grace elapsed — notify via callback.
      onError?.(err);
    },
  );

  const gracePromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve();
      }
    }, MATRIX_CLIENT_STARTUP_GRACE_MS);
  });

  await Promise.race([startPromise, gracePromise]);
}
