import type { SandboxExecutionMetadata } from "./modules/plugins/execution-metadata";

export const emptySandboxExecutionMetadata = {
	capabilities: [],
	runtimeImports: [],
	oauthConnectionFields: [],
	executableDependencies: [],
	optionalPluginConfigKeys: [],
	requiredPluginConfigKeys: [],
} as const satisfies SandboxExecutionMetadata;
