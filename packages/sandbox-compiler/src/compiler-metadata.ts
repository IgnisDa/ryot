import {
	SandboxExecutionMetadata,
	type SandboxSourceExecutionMetadata,
} from "@ryot-app/contract/modules/plugins/execution-metadata";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/sandbox/wire";
import type { SandboxManifest } from "@ryot-app/sandbox-sdk/core";
import { Result, Schema } from "effect";

import { sandboxCompilerDiagnostic, type SandboxCompilerDiagnostic } from "./compiler-diagnostics";
import type { CompiledSandboxModule } from "./compiler-protocol";
import { jsonByteLength, SANDBOX_COMPILER_LIMITS } from "./limits";

const decodeSandboxExecutionMetadata = Schema.decodeUnknownResult(SandboxExecutionMetadata);

export const validateSandboxCapabilities = (
	manifest: SandboxManifest & SandboxSourceExecutionMetadata,
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

export const finalizeCompiledManifest = (
	authored: SandboxManifest,
	derived: SandboxExecutionMetadata,
): Result.Result<CompiledSandboxModule["manifest"], SandboxCompilerDiagnostic> => {
	const decoded = decodeSandboxExecutionMetadata(derived);
	if (Result.isFailure(decoded)) {
		return Result.fail(
			sandboxCompilerDiagnostic(
				"RYOT_METADATA",
				`Compiled sandbox execution metadata is invalid: ${String(decoded.failure)}`,
			),
		);
	}
	const manifest = { ...authored, ...decoded.success };
	if (
		(jsonByteLength(manifest) ?? Number.POSITIVE_INFINITY) > SANDBOX_COMPILER_LIMITS.manifestBytes
	) {
		return Result.fail(
			sandboxCompilerDiagnostic(
				"RYOT_MANIFEST_SIZE",
				`Sandbox manifest exceeds ${SANDBOX_COMPILER_LIMITS.manifestBytes} UTF-8 bytes`,
			),
		);
	}
	return Result.succeed(manifest);
};
