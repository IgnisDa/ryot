import { Effect } from "effect";

import { compileClientPlugin } from "./compile";
import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import {
	clientCompilerWorkerFailure,
	clientCompilerWorkerSuccess,
	decodeClientCompilerWorkerRequest,
	encodeClientCompilerWorkerResponse,
} from "./protocol";

const workerFailure = (message: string) =>
	clientPluginCompilationFailure([
		clientPluginCompilerDiagnostic("RYOT_CLIENT_COMPILER_PROCESS", "client", message),
	]);

const response = await Effect.runPromise(
	Effect.tryPromise({
		try: () => Bun.stdin.text(),
		catch: (error) =>
			workerFailure(`Client plugin compiler input could not be read: ${String(error)}`),
	}).pipe(
		Effect.flatMap((input) =>
			decodeClientCompilerWorkerRequest(input).pipe(
				Effect.mapError((error) =>
					workerFailure(`Client plugin compiler input could not be decoded: ${String(error)}`),
				),
			),
		),
		Effect.flatMap(compileClientPlugin),
		Effect.match({
			onFailure: clientCompilerWorkerFailure,
			onSuccess: clientCompilerWorkerSuccess,
		}),
	),
);

process.stdout.write(`${encodeClientCompilerWorkerResponse(response)}\n`);
