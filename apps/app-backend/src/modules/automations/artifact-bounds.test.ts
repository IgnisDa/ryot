import { assert, describe, expect, it } from "vitest";

import {
	boundSandboxError,
	boundSandboxLogs,
	boundProviderSandboxValue,
	boundSandboxValue,
	providerSandboxArtifactLimits,
	sandboxArtifactLimits,
	utf8ByteLength,
} from "#lib/infrastructure/sandbox-runtime/serialization-bounds";

import { automationArtifactLimits, boundTriggerSnapshot } from "./artifact-bounds";

describe("automation artifact bounds", () => {
	it("fails only an oversized sandbox value", () => {
		expect(
			boundSandboxValue({ value: "x".repeat(automationArtifactLimits.maxValueBytes) }),
		).toEqual({
			kind: "result_too_large",
			byteSize: automationArtifactLimits.maxValueBytes + 12,
		});
		expect(boundSandboxValue({ value: "ok" })).toEqual({
			kind: "accepted",
			value: { value: "ok" },
		});
	});

	it("stores medium provider values as artifacts and rejects oversized values", () => {
		const artifact = boundProviderSandboxValue("x".repeat(sandboxArtifactLimits.maxValueBytes + 1));
		const rejected = boundProviderSandboxValue(
			"x".repeat(providerSandboxArtifactLimits.maxValueBytes + 1),
		);

		expect(artifact.kind).toBe("artifact");
		expect(rejected.kind).toBe("result_too_large");
	});

	it("bounds log count, entry bytes, and combined bytes", () => {
		const logs = Array.from({ length: 150 }, () => "💥".repeat(2_000));
		const bounded = boundSandboxLogs(logs);
		expect(bounded.length).toBeLessThanOrEqual(automationArtifactLimits.maxLogs);
		expect(bounded.at(-1)).toBe("[logs truncated]");
		expect(
			bounded.every((entry) => utf8ByteLength(entry) <= automationArtifactLimits.maxLogBytes),
		).toBe(true);
		expect(utf8ByteLength(bounded.join(""))).toBeLessThanOrEqual(
			automationArtifactLimits.maxTotalLogBytes,
		);
	});

	it("bounds errors without splitting UTF-8", () => {
		const bounded = boundSandboxError("💥".repeat(10_000));
		assert(bounded !== null);
		expect(utf8ByteLength(bounded)).toBeLessThanOrEqual(automationArtifactLimits.maxErrorBytes);
		expect(bounded).toContain("[truncated]");
	});

	it("replaces oversized snapshots with deterministic core metadata", () => {
		const bounded = boundTriggerSnapshot({
			automation: {
				ruleId: "rule-1",
				operation: "create",
				origin: { kind: "api" },
				occurrenceId: "occurrence-1",
				source: { kind: "entity", after: { properties: { value: "x".repeat(300_000) } } },
			},
		});
		expect(bounded).toMatchObject({
			truncated: true,
			core: { ruleId: "rule-1", operation: "create", occurrenceId: "occurrence-1" },
		});
	});
});
