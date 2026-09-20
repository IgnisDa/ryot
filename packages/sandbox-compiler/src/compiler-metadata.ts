import type { SandboxExecutionMetadata } from "@ryot-app/contract/modules/plugins/execution-metadata";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/sandbox/wire";
import type { SandboxManifest } from "@ryot-app/sandbox-sdk/core";

import { sandboxCompilerDiagnostic, type SandboxCompilerDiagnostic } from "./compiler-diagnostics";

export const validateCompiledSandboxManifest = (
	manifest: SandboxManifest & SandboxExecutionMetadata,
): SandboxCompilerDiagnostic | undefined => {
	if (manifest.kind === "workflow" && manifest.capabilities.length > 0) {
		return sandboxCompilerDiagnostic("RYOT_CAPABILITY", "Workflows cannot use host capabilities");
	}
	if (manifest.kind !== "automation" || manifest.automationType !== "policy") {
		return undefined;
	}

	const unsafeCapability = manifest.capabilities.find(
		(capability) => !POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability),
	);
	if (unsafeCapability) {
		return sandboxCompilerDiagnostic(
			"RYOT_CAPABILITY",
			`Automation policies cannot use the host capability "${unsafeCapability}"`,
		);
	}
	if (manifest.executableDependencies.some(({ kind }) => kind === "workflow")) {
		return sandboxCompilerDiagnostic(
			"RYOT_CAPABILITY",
			"Automation policies cannot depend on workflows",
		);
	}
	return undefined;
};
