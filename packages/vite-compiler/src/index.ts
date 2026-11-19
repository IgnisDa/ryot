export { ViteCompilerError } from "./error";
export { collectViteOutputs } from "./output";

export type { CollectedViteFile } from "./output";

export { buildWithVite, ViteBuildService } from "./vite";

export { buildSandboxEsm, buildSandboxEsmPackage } from "./sandbox";
export type { ViteCompilerResult, ViteCompilerOptions } from "./vite";

export { validateRelativePath, acquireCompilerWorkspace } from "./workspace";
export type { WorkspaceFile, CompilerWorkspace, CompilerWorkspaceOptions } from "./workspace";

export type { ViteDiagnostic, ViteDiagnosticLocation, ViteCompilerErrorReason } from "./error";
export type {
	SandboxEsmAlias,
	SandboxEsmBuildResult,
	SandboxEsmBuildOptions,
	SandboxEsmPackageModule,
	SandboxEsmStagedBuildOptions,
	SandboxEsmPackageBuildOptions,
	SandboxEsmExternalBuildOptions,
} from "./sandbox";
