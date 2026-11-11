import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";

import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import { compileClientPluginModule } from "./module";
import { pluginClientCompilerPlatformLayer } from "./platform";
import {
	type ClientCompilerResponse,
	decodeClientCompilerWorkerRequest,
	encodeClientCompilerWorkerResponse,
} from "./protocol";

const workerFailure = (message: string) =>
	clientPluginCompilationFailure([
		clientPluginCompilerDiagnostic("RYOT_CLIENT_COMPILER_PROCESS", "client", message),
	]);

const program = Effect.tryPromise({
	try: () => Bun.stdin.text(),
	catch: () => workerFailure("Compiler input could not be read"),
}).pipe(
	Effect.flatMap((input) =>
		decodeClientCompilerWorkerRequest(input).pipe(
			Effect.mapError(() => workerFailure("Compiler input could not be decoded")),
		),
	),
	Effect.flatMap(({ input, workspaceJobId, workspaceParentPath }) =>
		compileClientPluginModule(input, { jobId: workspaceJobId, parentPath: workspaceParentPath }),
	),
	Effect.match({
		onSuccess: (value): ClientCompilerResponse => ({ value, success: true }),
		onFailure: (error): ClientCompilerResponse => ({ error, success: false }),
	}),
	Effect.flatMap(encodeClientCompilerWorkerResponse),
	Effect.flatMap((response) => Effect.sync(() => process.stdout.write(`${response}\n`))),
);
export const runClientCompilerWorker = () =>
	BunRuntime.runMain(program.pipe(Effect.provide(pluginClientCompilerPlatformLayer)));

if (import.meta.main) {
	runClientCompilerWorker();
}
