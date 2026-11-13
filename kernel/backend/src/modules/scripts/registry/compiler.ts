import { BunServices } from "@effect/platform-bun";
import { CompilerWorkerUnavailable } from "@ryot-app/compiler-worker/pool";
import { SandboxCompilationFailure } from "@ryot-app/contract/modules/scripts/schemas";
import { makeSandboxCompilerSupervisor } from "@ryot-app/plugin-backend-compiler/supervisor";
import { Context, Effect, Layer } from "effect";

import { compilerWorkerPath } from "#platform/process/compiler-worker";

export const makeSandboxCompiler = (workspaceDirectory?: string) =>
	Effect.gen(function* () {
		const supervisor = yield* makeSandboxCompilerSupervisor({
			workerPath: yield* compilerWorkerPath(
				"@ryot-app/plugin-backend-compiler/worker",
				"plugin-backend-compiler-worker.js",
			),
			...(workspaceDirectory === undefined ? {} : { workspaceDirectory }),
		});
		return {
			compile: (source: string) =>
				supervisor
					.compile(source)
					.pipe(
						Effect.mapError((error) =>
							error instanceof CompilerWorkerUnavailable
								? error
								: new SandboxCompilationFailure({
										message: error.message,
										diagnostics: error.diagnostics,
									}),
						),
					),
		};
	});

export class SandboxCompiler extends Context.Service<SandboxCompiler>()(
	"@ryot-app/kernel-backend/modules/scripts/registry/compiler/SandboxCompiler",
	{ make: makeSandboxCompiler().pipe(Effect.orDie) },
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(BunServices.layer));
}
