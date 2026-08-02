export {
	compileClientPlugin,
	type ClientPluginAutomaticRegistryEntry,
	type ClientPluginCompilerContributor,
	type ClientPluginCompilerGraphInput,
	type ClientPluginCompilerInput,
	type ClientPluginCompilerPackageExport,
	type ClientPluginCompilerPackageInput,
	type ClientPluginCompilerPublicExport,
	type ClientPluginExportKind,
} from "./compile";
export { ClientPluginCompilerDiagnostic, ClientPluginCompilerFailure } from "./diagnostics";
export type { ClientCompilerBenchmarkEvidence } from "./instrumentation";
export { STYLEX_TRACER_BUILD_FINGERPRINT } from "./stylex-tracer";
