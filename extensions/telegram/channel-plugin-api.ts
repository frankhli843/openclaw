// Keep bundled channel entry imports narrow so bootstrap/discovery paths do
// not drag the broad Telegram API barrel into lightweight plugin loads.
//
// IMPORTANT: Import each export separately to prevent the bundler from
// chunk-merging channel.ts and channel.setup.ts.  When they share a chunk,
// jiti's sync Proxy loader fails to resolve the minified named re-exports
// (e.g., `import { n as telegramPlugin }` from a shared chunk).
import { telegramPlugin as _tp } from "./src/channel.js";
import { telegramSetupPlugin as _tsp } from "./src/channel.setup.js";

export const telegramPlugin = _tp;
export const telegramSetupPlugin = _tsp;
