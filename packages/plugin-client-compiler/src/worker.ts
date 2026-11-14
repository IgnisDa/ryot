import { runCompilerWorker } from "@ryot-app/compiler-worker/host";
import { Effect } from "effect";

import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import { compileClientPluginModule } from "./module";
import {
	pluginClientCompilerEnvironmentLayer,
	pluginClientCompilerPlatformLayer,
} from "./platform";
import {
	type ClientCompilerResponse,
	decodeClientCompilerWorkerRequest,
	encodeClientCompilerWorkerResponse,
} from "./protocol";
import { CLIENT_COMPILER_WARM_UP_INPUT } from "./warm-up";

const handle = (request: string) =>
	decodeClientCompilerWorkerRequest(request).pipe(
		Effect.mapError(() =>
			clientPluginCompilationFailure([
				clientPluginCompilerDiagnostic(
					"RYOT_CLIENT_COMPILER_PROCESS",
					"client",
					"Compiler input could not be decoded",
				),
			]),
		),
		Effect.flatMap(({ input, workspaceJobId, workspaceParentPath }) =>
			compileClientPluginModule(input, { jobId: workspaceJobId, parentPath: workspaceParentPath }),
		),
		Effect.match({
			onSuccess: (value): ClientCompilerResponse => ({ value, success: true }),
			onFailure: (error): ClientCompilerResponse => ({ error, success: false }),
		}),
		Effect.flatMap(encodeClientCompilerWorkerResponse),
		Effect.orDie,
	);

export const runClientCompilerWorker = () =>
	runCompilerWorker({
		handle,
		warmUp: compileClientPluginModule(CLIENT_COMPILER_WARM_UP_INPUT),
		layer: ({ verifyEnvironment }) =>
			verifyEnvironment ? pluginClientCompilerEnvironmentLayer : pluginClientCompilerPlatformLayer,
	});

if (import.meta.main) {
	runClientCompilerWorker();
}
