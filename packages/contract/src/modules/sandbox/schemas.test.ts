import { Schema } from "effect";
import { expect, it } from "vitest";

import { SandboxExecutionSubject } from "./schemas";

const subject = {
	runId: "run-1",
	pluginId: null,
	stage: "before",
	executionUserId: null,
	type: "automation-run",
	triggerId: "trigger-1",
	pluginRevisionId: null,
	pluginConfigRevisionId: null,
	causation: {
		depth: 0,
		source: "api",
		parentRunId: null,
		parentTriggerId: null,
		executionId: "execution-1",
		rootExecutionId: "execution-1",
		initiator: { id: null, kind: "system" },
	},
};

it("accepts source-zero and complete plugin automation ownership, but rejects partial pins", () => {
	const decode = Schema.decodeUnknownSync(SandboxExecutionSubject);
	expect(decode(subject)).toEqual(subject);
	const plugin = {
		...subject,
		stage: "after",
		pluginId: "plugin-1",
		executionUserId: "user-1",
		pluginRevisionId: "revision-1",
		pluginConfigRevisionId: "config-1",
	};
	expect(decode(plugin)).toEqual(plugin);
	for (const key of ["pluginId", "pluginRevisionId", "pluginConfigRevisionId"] as const) {
		expect(() => decode({ ...plugin, [key]: null })).toThrow();
	}
});

it("rejects legacy automation subjects and retains direct user integration scope", () => {
	const decode = Schema.decodeUnknownSync(SandboxExecutionSubject);
	expect(decode({ type: "system" })).toEqual({ type: "system" });
	expect(decode({ type: "user", userId: "user-1", integrationId: "integration-1" })).toEqual({
		type: "user",
		userId: "user-1",
		integrationId: "integration-1",
	});
	for (const legacy of [
		{ type: "system", automationRunId: "run-1" },
		{ type: "system", automationOccurrenceId: "occurrence-1" },
		{ type: "user", userId: "user-1", automationOccurrenceId: "occurrence-1" },
		{ type: "user", userId: "user-1", automationRunId: "run-1" },
	]) {
		expect(() => decode(legacy)).toThrow();
	}
});
