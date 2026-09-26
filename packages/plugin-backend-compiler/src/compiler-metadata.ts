import {
	SandboxExecutionMetadata,
	type SandboxSourceExecutionMetadata,
} from "@ryot-app/contract/modules/plugins/execution-metadata";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/sandbox/wire";
import type { SandboxManifest } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Result, Schema } from "effect";

import {
	sandboxCompilationFailure,
	pluginBackendCompilerDiagnostic,
	type PluginBackendCompilerDiagnostic,
} from "./compiler-diagnostics";
import { type CompiledSandboxModule, SANDBOX_COMPILED_FORMAT } from "./compiler-protocol";
import { jsonByteLength, SANDBOX_COMPILER_LIMITS, utf8ByteLength } from "./limits";

const decodeSandboxExecutionMetadata = Schema.decodeUnknownResult(SandboxExecutionMetadata);

export const validateSandboxCapabilities = (
	manifest: SandboxManifest & SandboxSourceExecutionMetadata,
): PluginBackendCompilerDiagnostic | undefined => {
	if (manifest.kind === "workflow" && manifest.capabilities.length > 0) {
		return pluginBackendCompilerDiagnostic(
			"RYOT_CAPABILITY",
			"Workflows cannot use host capabilities",
		);
	}
	if (manifest.kind !== "automation" || manifest.automationType !== "policy") {
		return undefined;
	}
	const unsafeCapability = manifest.capabilities.find(
		(capability) => !POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability),
	);
	if (unsafeCapability) {
		return pluginBackendCompilerDiagnostic(
			"RYOT_CAPABILITY",
			`Automation policies cannot use the host capability "${unsafeCapability}"`,
		);
	}
	if (manifest.executableDependencies.some(({ kind }) => kind === "workflow")) {
		return pluginBackendCompilerDiagnostic(
			"RYOT_CAPABILITY",
			"Automation policies cannot depend on workflows",
		);
	}
	return undefined;
};

export const finalizeCompiledManifest = (
	authored: SandboxManifest,
	derived: SandboxExecutionMetadata,
): Result.Result<CompiledSandboxModule["manifest"], PluginBackendCompilerDiagnostic> => {
	const decoded = decodeSandboxExecutionMetadata(derived);
	if (Result.isFailure(decoded)) {
		return Result.fail(
			pluginBackendCompilerDiagnostic(
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
			pluginBackendCompilerDiagnostic(
				"RYOT_MANIFEST_SIZE",
				`Sandbox manifest exceeds ${SANDBOX_COMPILER_LIMITS.manifestBytes} UTF-8 bytes`,
			),
		);
	}
	return Result.succeed(manifest);
};

export const finalizeCompiledModule = Effect.fnUntraced(function* (input: {
	javascript: string;
	manifest: SandboxManifest;
	metadata: SandboxSourceExecutionMetadata;
	runtimeImports: SandboxExecutionMetadata["runtimeImports"];
}) {
	if (utf8ByteLength(input.javascript) > SANDBOX_COMPILER_LIMITS.javascriptBytes) {
		return yield* sandboxCompilationFailure([
			pluginBackendCompilerDiagnostic(
				"RYOT_COMPILED_SIZE",
				`Compiled sandbox module exceeds ${SANDBOX_COMPILER_LIMITS.javascriptBytes} UTF-8 bytes`,
			),
		]);
	}
	const manifest = finalizeCompiledManifest(input.manifest, {
		...input.metadata,
		runtimeImports: input.runtimeImports,
	});
	if (Result.isFailure(manifest)) {
		return yield* sandboxCompilationFailure([manifest.failure]);
	}
	return {
		manifest: manifest.success,
		javascript: input.javascript,
		format: SANDBOX_COMPILED_FORMAT,
	} satisfies CompiledSandboxModule;
});
