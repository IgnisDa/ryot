import { BunServices } from "@effect/platform-bun";
import {
	type CompilerJobFailure,
	CompilerWorkerUnavailable,
	makeCompilerWorkerPool,
} from "@ryot-app/compiler-worker/pool";
import type {
	DefinitionSetChange,
	DefinitionSetPlugin,
} from "@ryot-app/definitions/definition-set";
import {
	decodeDefinitionSetValidationResponse,
	encodeDefinitionSetValidationRequest,
} from "@ryot-app/definitions/definition-set-protocol";
import type { DefinitionSource } from "@ryot-app/definitions/snapshot";
import { Context, Effect, Layer, Match } from "effect";

import { compilerWorkerPath } from "#platform/process/compiler-worker";

import { PluginValidationError } from "./validation";

const MiB = 1024 ** 2;

export const DEFINITION_SET_WORKER_LIMITS = {
	outputBytes: MiB,
	idleTimeoutMs: 0,
	cpuTimeMs: 60_000,
	timeoutMs: 120_000,
	memoryBytes: 1024 * MiB,
	startupTimeoutMs: 30_000,
	memoryPollIntervalMs: 50,
	recycleMemoryBytes: 512 * MiB,
};

export type DefinitionSetWorkerLimits = typeof DEFINITION_SET_WORKER_LIMITS;

const invalidResult = new CompilerWorkerUnavailable({
	message: "The definition set worker returned an invalid result",
});

export const makeDefinitionSetValidator = Effect.fnUntraced(function* (
	limits: DefinitionSetWorkerLimits,
) {
	const pool = yield* makeCompilerWorkerPool({
		...limits,
		env: {},
		size: 1,
		label: "definition-set",
		path: yield* compilerWorkerPath(
			"@ryot-app/kernel-backend/modules/plugins/packages/definition-set-worker",
			"definition-set-worker.js",
		),
		jobFailure: Match.type<CompilerJobFailure>().pipe(
			Match.when(
				"CpuTimeExceeded",
				() =>
					new PluginValidationError({
						issues: [`Definition set validation used more than ${limits.cpuTimeMs}ms of CPU time`],
					}),
			),
			Match.when(
				"MemoryExceeded",
				() =>
					new PluginValidationError({
						issues: [`Definition set validation exceeded ${limits.memoryBytes} bytes of memory`],
					}),
			),
			Match.when("OutputExceeded", () => invalidResult),
			Match.exhaustive,
		),
	});
	const validate = Effect.fn("DefinitionSetValidator.validate")(function* (
		baseline: DefinitionSource,
		plugins: ReadonlyArray<DefinitionSetPlugin>,
		change?: DefinitionSetChange,
	) {
		const output = yield* pool.run(() =>
			encodeDefinitionSetValidationRequest(baseline, plugins, change).pipe(Effect.orDie),
		);
		const response = yield* decodeDefinitionSetValidationResponse(output).pipe(
			Effect.mapError(() => invalidResult),
		);
		if (!response.valid) {
			return yield* new PluginValidationError({ issues: [response.issue] });
		}
		return yield* Effect.void;
	});
	return { validate };
});

export class DefinitionSetValidator extends Context.Service<DefinitionSetValidator>()(
	"@ryot-app/kernel-backend/modules/plugins/packages/definition-set-validator/DefinitionSetValidator",
	{ make: makeDefinitionSetValidator(DEFINITION_SET_WORKER_LIMITS).pipe(Effect.orDie) },
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(BunServices.layer));
}
