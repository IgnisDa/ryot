import { Effect } from "effect";

import { compileSandboxSource } from "./compiler-core";
import { sandboxCompilationFailure, sandboxCompilerDiagnostic } from "./compiler-diagnostics";
import { compilerWorkerFailure, compilerWorkerSuccess } from "./compiler-protocol";

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
		Effect.flatMap(compileSandboxSource),
		Effect.match({
			onFailure: compilerWorkerFailure,
			onSuccess: compilerWorkerSuccess,
		}),
	),
);

process.stdout.write(JSON.stringify(response));
