export {
	acquireCompilerWorkspace,
	getCompilerWorkspaceRoot,
	stageGeneratedFiles,
	stageSourceFiles,
	validateRelativePath,
} from "./workspace";
export type {
	AddressedCompilerWorkspaceOptions,
	CompilerWorkspace,
	CompilerWorkspaceOptions,
	WorkspaceFile,
	WorkspaceInput,
	WorkspaceSymlink,
} from "./workspace";

export { sanitizeEnvironment } from "./environment";
export type { SanitizeEnvironmentOptions } from "./environment";

export { collectViteOutputs } from "./output";
export type { CollectedViteFile } from "./output";

export { ViteBuildInvocationError, ViteCompilerError } from "./error";
export type { ViteCompilerErrorReason, ViteDiagnostic, ViteDiagnosticLocation } from "./error";

export { buildWithVite, ViteBuildService } from "./vite";
export type { ViteCompilerOptions, ViteCompilerResult } from "./vite";
