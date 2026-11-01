export { ViteCompilerError } from "./error";
export { collectViteOutputs } from "./output";

export type { CollectedViteFile } from "./output";
export { sanitizeEnvironment } from "./environment";

export { buildWithVite, ViteBuildService } from "./vite";
export type { SanitizeEnvironmentOptions } from "./environment";

export type { ViteCompilerResult, ViteCompilerOptions } from "./vite";
export { buildSandboxEsm, auditSandboxEsmOutput, buildSandboxEsmPackage } from "./sandbox";

export type { WorkspaceFile, CompilerWorkspace, CompilerWorkspaceOptions } from "./workspace";
export type { ViteDiagnostic, ViteDiagnosticLocation, ViteCompilerErrorReason } from "./error";

export {
	validateRelativePath,
	acquireCompilerWorkspace,
	getCompilerWorkspaceRoot,
} from "./workspace";
export type {
	SandboxEsmAlias,
	SandboxEsmBuildResult,
	SandboxEsmBuildOptions,
	SandboxEsmPackageModule,
	SandboxEsmStagedBuildOptions,
	SandboxEsmPackageBuildOptions,
	SandboxEsmExternalBuildOptions,
} from "./sandbox";
