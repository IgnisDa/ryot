import { SandboxExecutionMetadata } from "@ryot-app/contract/modules/plugins/execution-metadata";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/sandbox/wire";
import { sandboxManifestSchema, type SandboxManifest } from "@ryot-app/sandbox-sdk/core";
import { Result, Schema } from "effect";

import { sandboxCompilerDiagnostic, type SandboxCompilerDiagnostic } from "./compiler-diagnostics";

const decodeSandboxExecutionMetadata = Schema.decodeUnknownResult(SandboxExecutionMetadata);
const decodeSandboxManifest = Schema.decodeUnknownResult(sandboxManifestSchema);

export const validateCompiledSandboxManifest = (
	manifest: SandboxManifest & Schema.Schema.Type<typeof SandboxExecutionMetadata>,
): SandboxCompilerDiagnostic | undefined => {
	if (manifest.kind === "workflow" && manifest.capabilities.length > 0) {
		return sandboxCompilerDiagnostic("RYOT_CAPABILITY", "Workflows cannot use host capabilities");
	}
	if (manifest.kind === "automation" && manifest.automationType === "policy") {
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
	}
	const decoded = decodeSandboxExecutionMetadata({
		capabilities: manifest.capabilities,
		runtimeImports: manifest.runtimeImports,
		oauthConnectionFields: manifest.oauthConnectionFields,
		executableDependencies: manifest.executableDependencies,
		optionalPluginConfigKeys: manifest.optionalPluginConfigKeys,
		requiredPluginConfigKeys: manifest.requiredPluginConfigKeys,
	});
	if (Result.isFailure(decoded)) {
		return sandboxCompilerDiagnostic(
			"RYOT_METADATA",
			`Compiled sandbox execution metadata is invalid: ${String(decoded.failure)}`,
		);
	}
	const authoredManifest = Object.fromEntries(
		Object.entries(manifest).filter(
			([key]) => !Object.hasOwn(SandboxExecutionMetadata.fields, key),
		),
	);
	const decodedManifest = decodeSandboxManifest(authoredManifest);
	if (Result.isFailure(decodedManifest)) {
		return sandboxCompilerDiagnostic(
			"RYOT_MANIFEST",
			`Compiled sandbox manifest is invalid: ${String(decodedManifest.failure)}`,
		);
	}
	return undefined;
};
