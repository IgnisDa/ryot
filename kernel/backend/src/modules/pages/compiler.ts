import { BunServices } from "@effect/platform-bun";
import { makeClientCompilerSupervisor } from "@ryot-app/plugin-client-compiler/supervisor";
import { Context, Effect, Layer } from "effect";

import { compilerWorkerPath } from "#platform/process/compiler-worker";

export class ClientPluginCompiler extends Context.Service<ClientPluginCompiler>()(
	"@ryot-app/kernel-backend/modules/pages/compiler/ClientPluginCompiler",
	{
		make: Effect.gen(function* () {
			return yield* makeClientCompilerSupervisor({
				workerPath: yield* compilerWorkerPath(
					"@ryot-app/plugin-client-compiler/worker",
					"plugin-client-compiler-worker.js",
				),
			});
		}).pipe(Effect.orDie),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(BunServices.layer));
}
