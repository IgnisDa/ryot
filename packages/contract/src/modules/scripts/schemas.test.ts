import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { SandboxExecutionSubject } from "./schemas";

const subject = {
	runId: "run-1",
	pluginId: null,
	stage: "before",
	delivery: "policy",
	executionUserId: null,
	type: "automation-run",
	triggerId: "trigger-1",
	pluginRevisionId: null,
	accountGeneration: null,
	pluginConfigRevisionId: null,
	causation: {
		depth: 0,
		source: "api",
		parentRunId: null,
		lane: "interactive",
		parentTriggerId: null,
		executionId: "execution-1",
		rootExecutionId: "execution-1",
		initiator: { id: null, kind: "system" },
	},
};

it.effect(
	"accepts source-zero and complete plugin automation ownership, but rejects partial pins",
	() =>
		Effect.gen(function* () {
			const decode = Schema.decodeUnknownEffect(SandboxExecutionSubject);
			expect(yield* decode(subject)).toEqual(subject);
			const plugin = {
				...subject,
				stage: "after",
				delivery: "required",
				pluginId: "plugin-1",
				executionUserId: "user-1",
				pluginRevisionId: "revision-1",
				pluginConfigRevisionId: "config-1",
				accountGeneration: { userId: "user-1", token: "generation-1" },
			};
			expect(yield* decode(plugin)).toEqual(plugin);
			for (const key of ["pluginId", "pluginRevisionId", "pluginConfigRevisionId"] as const) {
				yield* Effect.flip(decode({ ...plugin, [key]: null }));
			}
		}),
);

it.effect("rejects legacy automation subjects and retains direct user integration scope", () =>
	Effect.gen(function* () {
		const decode = Schema.decodeUnknownEffect(SandboxExecutionSubject);
		expect(yield* decode({ type: "system" })).toEqual({ type: "system" });
		expect(
			yield* decode({
				type: "user",
				userId: "user-1",
				importRunId: "import-run-1",
				integrationId: "integration-1",
				integrationRunId: "integration-run-1",
				accountGeneration: { userId: "user-1", token: "generation-1" },
			}),
		).toEqual({
			type: "user",
			userId: "user-1",
			importRunId: "import-run-1",
			integrationId: "integration-1",
			integrationRunId: "integration-run-1",
			accountGeneration: { userId: "user-1", token: "generation-1" },
		});
		for (const legacy of [
			{ type: "system", automationRunId: "run-1" },
			{ type: "system", automationOccurrenceId: "occurrence-1" },
			{ type: "user", userId: "user-1", automationOccurrenceId: "occurrence-1" },
			{ type: "user", userId: "user-1", automationRunId: "run-1" },
		]) {
			yield* Effect.flip(decode(legacy));
		}
	}),
);
