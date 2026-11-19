import { runCompilerWorker } from "@ryot-app/compiler-worker/host";
import { Effect, Schema } from "effect";

import { compileSandboxSource } from "./compiler-core";
import { pluginBackendCompilerDiagnostic, sandboxCompilationFailure } from "./compiler-diagnostics";
import {
	pluginBackendCompilerEnvironmentLayer,
	pluginBackendCompilerPlatformLayer,
} from "./compiler-platform";
import {
	compilerWorkerFailure,
	CompilerWorkerRequest,
	CompilerWorkerResponse,
	compilerWorkerSuccess,
} from "./compiler-protocol";
import { SANDBOX_COMPILER_WARM_UP_SOURCE } from "./compiler-warm-up";

const decodeRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(CompilerWorkerRequest));
const encodeResponse = Schema.encodeEffect(Schema.fromJsonString(CompilerWorkerResponse));

const handle = (input: string) =>
	decodeRequest(input).pipe(
		Effect.mapError((error) =>
			sandboxCompilationFailure([
				pluginBackendCompilerDiagnostic(
					"RYOT_COMPILER_PROCESS",
					`Sandbox compiler request is invalid: ${String(error)}`,
				),
			]),
		),
		Effect.flatMap(({ source, workspaceJobId, workspaceParentPath }) =>
			compileSandboxSource(source, { jobId: workspaceJobId, parentPath: workspaceParentPath }),
		),
		Effect.match({ onFailure: compilerWorkerFailure, onSuccess: compilerWorkerSuccess }),
		Effect.flatMap(encodeResponse),
		Effect.orDie,
	);

export const runBackendCompilerWorker = () =>
	runCompilerWorker({
		handle,
		warmUp: compileSandboxSource(SANDBOX_COMPILER_WARM_UP_SOURCE),
		layer: ({ verifyEnvironment }) =>
			verifyEnvironment
				? pluginBackendCompilerEnvironmentLayer
				: pluginBackendCompilerPlatformLayer,
	});

if (import.meta.main) {
	runBackendCompilerWorker();
}
