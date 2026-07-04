export {
	acquireCompilerWorkspace,
	getCompilerWorkspaceRoot,
	stageGeneratedFiles,
	stageSourceFiles,
	validateRelativePath,
} from "./workspace";
export type { CompilerWorkspace, CompilerWorkspaceOptions, WorkspaceFile } from "./workspace";

export { sanitizeEnvironment } from "./environment";
export type { SanitizeEnvironmentOptions } from "./environment";

export { collectViteOutputs } from "./output";
export type { CollectedViteFile } from "./output";

export { ViteCompilerError } from "./error";
export type { ViteCompilerErrorReason, ViteDiagnostic, ViteDiagnosticLocation } from "./error";

export { buildWithVite, ViteBuildService } from "./vite";
export type { ViteCompilerOptions, ViteCompilerResult } from "./vite";

export { auditDenoEsmOutput, buildDenoEsm } from "./deno";
export type {
	DenoEsmAlias,
	DenoEsmBuildOptions,
	DenoEsmBuildResult,
	DenoEsmExternalBuildOptions,
	DenoEsmStagedBuildOptions,
} from "./deno";
