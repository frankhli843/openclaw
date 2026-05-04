/**
 * Extension package-boundary declaration for global-agent.
 *
 * The root project has the same shim under src/types, but the Discord
 * boundary build only includes extension-local sources.
 */
declare module "global-agent" {
  export function bootstrap(): void;
}
