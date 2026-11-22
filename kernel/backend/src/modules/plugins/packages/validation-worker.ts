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
import { definitionSetValidationRequest } from "@ryot-app/definitions/definition-set-protocol";
import type { DefinitionSource } from "@ryot-app/definitions/snapshot";
import { Context, Effect, Layer, Match } from "effect";

import { compilerWorkerPath } from "#platform/process/compiler-worker";

import type { PluginSource } from "./types";
import { PluginValidationError } from "./validation";
import {
	decodeCheckPluginSourceResponse,
	decodeValidateDefinitionSetResponse,
	encodeCheckPluginSourceRequest,
	encodeValidateDefinitionSetRequest,
} from "./validation-worker-protocol";

const MiB = 1024 ** 2;

export const PLUGIN_VALIDATION_WORKER_LIMITS = {
	outputBytes: MiB,
	idleTimeoutMs: 0,
	cpuTimeMs: 60_000,
	timeoutMs: 120_000,
	memoryBytes: 1024 * MiB,
	startupTimeoutMs: 30_000,
	memoryPollIntervalMs: 50,
	recycleMemoryBytes: 512 * MiB,
};

export type PluginValidationWorkerLimits = typeof PLUGIN_VALIDATION_WORKER_LIMITS;

const invalidResult = new CompilerWorkerUnavailable({
	message: "The plugin validation worker returned an invalid result",
});

export const makePluginValidationWorker = Effect.fnUntraced(function* (
	limits: PluginValidationWorkerLimits,
) {
	const pool = yield* makeCompilerWorkerPool({
		...limits,
		env: {},
		size: 1,
		label: "plugin-validation",
		path: yield* compilerWorkerPath(
			"@ryot-app/kernel-backend/modules/plugins/packages/plugin-validation-worker",
			"plugin-validation-worker.js",
		),
		jobFailure: Match.type<CompilerJobFailure>().pipe(
			Match.when(
				"CpuTimeExceeded",
				() =>
					new PluginValidationError({
						issues: [`Plugin validation used more than ${limits.cpuTimeMs}ms of CPU time`],
					}),
			),
			Match.when(
				"MemoryExceeded",
				() =>
					new PluginValidationError({
						issues: [`Plugin validation exceeded ${limits.memoryBytes} bytes of memory`],
					}),
			),
			Match.when("OutputExceeded", () => invalidResult),
			Match.exhaustive,
		),
	});
	/** One worker serves every job of a session; it exits when the session's scope closes. */
	const session = Effect.map(pool.lease, (worker) => ({
		checkSource: Effect.fn("PluginValidationWorker.checkSource")(function* (source: PluginSource) {
			const output = yield* worker.run(() =>
				encodeCheckPluginSourceRequest({ ...source, _tag: "CheckPluginSource" }).pipe(Effect.orDie),
			);
			const response = yield* decodeCheckPluginSourceResponse(output).pipe(
				Effect.mapError(() => invalidResult),
			);
			if (!response.valid) {
				return yield* new PluginValidationError({ issues: response.issues });
			}
			return response.contentHash;
		}),
		validateDefinitionSet: Effect.fn("PluginValidationWorker.validateDefinitionSet")(function* (
			baseline: DefinitionSource,
			plugins: ReadonlyArray<DefinitionSetPlugin>,
			change?: DefinitionSetChange,
		) {
			const output = yield* worker.run(() =>
				encodeValidateDefinitionSetRequest(
					definitionSetValidationRequest(baseline, plugins, change),
				).pipe(Effect.orDie),
			);
			const response = yield* decodeValidateDefinitionSetResponse(output).pipe(
				Effect.mapError(() => invalidResult),
			);
			if (!response.valid) {
				return yield* new PluginValidationError({ issues: [response.issue] });
			}
			return yield* Effect.void;
		}),
	}));
	return { session };
});

export type PluginValidationSession = Effect.Success<
	Effect.Success<ReturnType<typeof makePluginValidationWorker>>["session"]
>;

export class PluginValidationWorker extends Context.Service<PluginValidationWorker>()(
	"@ryot-app/kernel-backend/modules/plugins/packages/validation-worker/PluginValidationWorker",
	{ make: makePluginValidationWorker(PLUGIN_VALIDATION_WORKER_LIMITS).pipe(Effect.orDie) },
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(BunServices.layer));
}
