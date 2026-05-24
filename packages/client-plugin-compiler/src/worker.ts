import { Effect, Schema } from "effect";

import { compileClientPlugin } from "./compile";
import { clientPluginCompilationFailure, clientPluginCompilerDiagnostic } from "./diagnostics";
import {
	ClientPluginCompilerRequest,
	clientCompilerWorkerFailure,
	clientCompilerWorkerSuccess,
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
			Schema.decodeUnknownEffect(Schema.fromJsonString(ClientPluginCompilerRequest))(input).pipe(
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

process.stdout.write(JSON.stringify(response));
