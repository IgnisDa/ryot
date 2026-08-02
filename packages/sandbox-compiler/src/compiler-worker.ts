import { Effect, Schema } from "effect";

import { compileSandboxSource } from "./compiler-core";
import { sandboxCompilationFailure, sandboxCompilerDiagnostic } from "./compiler-diagnostics";
import { sandboxCompilerPlatformLayer } from "./compiler-platform";
import {
	CompilerWorkerRequest,
	compilerWorkerFailure,
	compilerWorkerSuccess,
} from "./compiler-protocol";

const decodeRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(CompilerWorkerRequest));

const response = await Effect.runPromise(
	Effect.tryPromise({
		try: () => Bun.stdin.text(),
		catch: (error) =>
			sandboxCompilationFailure([
				sandboxCompilerDiagnostic(
					"RYOT_COMPILER_PROCESS",
					`Sandbox compiler input could not be read: ${String(error)}`,
				),
			]),
	}).pipe(
		Effect.flatMap((input) =>
			decodeRequest(input).pipe(
				Effect.mapError((error) =>
					sandboxCompilationFailure([
						sandboxCompilerDiagnostic(
							"RYOT_COMPILER_PROCESS",
							`Sandbox compiler request is invalid: ${String(error)}`,
						),
					]),
				),
			),
		),
		Effect.flatMap(({ source, workspaceJobId, workspaceParentPath }) =>
			compileSandboxSource(source, { jobId: workspaceJobId, parentPath: workspaceParentPath }),
		),
		Effect.match({ onFailure: compilerWorkerFailure, onSuccess: compilerWorkerSuccess }),
		Effect.provide(sandboxCompilerPlatformLayer),
	),
);

process.stdout.write(JSON.stringify(response));
