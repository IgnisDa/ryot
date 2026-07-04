import { expect, it } from "@effect/vitest";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { dbRunnerLayer } from "#lib/test-utils/effect";

import {
	executeSandboxExecution,
	makeSandboxExecutionResolutionActivity,
	SandboxExecutionQueue,
} from "./durable-queues";
import { SandboxRepository } from "./repository";

it("journals plugin resolution without changing the durable queue identity", () => {
	const payload = {
		context: {},
		userId: null,
		driverName: "details",
		scriptId: SandboxScriptId.make("historical-script-id"),
		executionId: "execution-id",
	};

	expect(makeSandboxExecutionResolutionActivity(payload).name).toBe(
		"resolve-sandbox-execution-execution-id",
	);
	expect(SandboxExecutionQueue.idempotencyKey(payload)).toBe("execution-id");
});

it.effect("executes the exact queued plugin row after the active plugin updates", () => {
	const queuedScriptId = SandboxScriptId.make("queued-script-id");
	let executedCode: string | undefined;
	let executedScriptId: string | undefined;
	let executedScriptIsBuiltin: boolean | undefined;
	const repository = Layer.mock(SandboxRepository)({
		_tag: "SandboxRepository",
		getScript: (scriptId) =>
			Effect.succeed({
				id: scriptId,
				metadata: {},
				compiledFormat: 1,
				compiledCode: "queued-version",
			}),
	});
	const sandbox = Layer.mock(RuntimeSandboxService)({
		_tag: "SandboxService",
		run: (input) =>
			Effect.sync(() => {
				executedCode = input.compiledCode;
				executedScriptId = input.scriptId;
				executedScriptIsBuiltin = input.scriptIsBuiltin;
				return {
					logs: [],
					error: null,
					success: true,
					value: "queued-result",
					executionId: input.executionId,
					timing: { totalMs: 1, executionMs: 1 },
				};
			}),
	});
	const layer = Layer.mergeAll(dbRunnerLayer, repository, sandbox);

	return Effect.gen(function* () {
		const result = yield* executeSandboxExecution({
			context: {},
			userId: null,
			driverName: "details",
			scriptId: queuedScriptId,
			executionId: "execution-id",
		});

		expect(executedCode).toBe("queued-version");
		expect(executedScriptId).toBe(queuedScriptId);
		expect(executedScriptIsBuiltin).toBe(true);
		expect(result.value).toBe("queued-result");
	}).pipe(Effect.provide(layer));
});
