/**
 * Public entry point for the `create-act-app` package. The bin shim imports
 * {@link runCli} from this module; downstream tooling can also use the
 * exported helpers directly.
 */
export { runCli, type RunCliOptions } from './cli.js';
export { copyTemplate, DestinationNotEmptyError } from './copy-template.js';
export { rewritePackageJson, hasWorkspaceRefs, type PackageJsonLike, type RewriteOptions } from './rewrite-package-json.js';
export {
  buildCommand,
  detectPackageManager,
  installCommand,
  runInstall,
} from './install-deps.js';
export { findTemplate, loadManifest, resolveTemplatesDir } from './manifest.js';
export { isValidProjectName } from './prompts.js';
export type { PackageManager, Sink, TemplateManifest, TemplateManifestEntry } from './types.js';
export { ACT_DEP_VERSION_RANGE, CREATE_ACT_APP_VERSION } from './version.js';
