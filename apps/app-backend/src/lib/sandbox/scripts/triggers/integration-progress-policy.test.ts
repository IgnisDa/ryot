import { describe, expect, it } from "bun:test";

import integrationProgressPolicyScriptCode from "./integration-progress-policy.txt";
import { hostFailure, hostSuccess, runTriggerScript } from "./test-utils";

type EventFixture = {
	occurredAt: string;
	createdAt?: string;
	properties: Record<string, unknown>;
};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const createTrigger = (overrides: Record<string, unknown> = {}) => ({
	trigger: {
		entityId: "entity_1",
		origin: "integration",
		entitySchemaSlug: "movie",
		eventSchemaSlug: "progress",
		integrationId: "integration_1",
		occurredAt: minutesAgo(0),
		properties: { progressPercent: 50, consumedOn: "Plex" },
		...overrides,
	},
});

const createHostFunctions = (options: {
	events?: EventFixture[];
	thresholdHours?: string | number | null;
	integration?: Record<string, unknown> | null;
}) => {
	const calls: string[] = [];

	return {
		calls,
		hostFunctions: {
			getIntegration: () => {
				calls.push("getIntegration");
				return options.integration ? hostSuccess(options.integration) : hostFailure();
			},
			listEvents: () => {
				calls.push("listEvents");
				return hostSuccess(options.events ?? []);
			},
			getSystemConfig: () => {
				calls.push("getSystemConfig");
				return hostSuccess({
					system: { scheduler: { progressUpdateThresholdHours: options.thresholdHours ?? "2" } },
				});
			},
		},
	};
};

const claimsTrue = () => ({ success: true, data: { claimed: true } });
const claimsFalse = () => ({ success: true, data: { claimed: false } });

const integration = (overrides: Record<string, unknown> = {}) => ({
	id: "integration_1",
	minimumProgress: "2",
	maximumProgress: "95",
	...overrides,
});

describe("integration-progress-policy sandbox script", () => {
	it("allows non-integration events immediately without any API calls", async () => {
		const { calls, hostFunctions } = createHostFunctions({ integration: integration() });

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ origin: "api" }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({ action: "allow" });
		expect(calls).toHaveLength(0);
	});

	it("skips when progressPercent cannot be parsed", async () => {
		const { calls, hostFunctions } = createHostFunctions({ integration: integration() });

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: "not-a-number", consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({ action: "skip", reason: "invalid_progress" });
		expect(calls).toHaveLength(0);
	});

	it("skips progress below the integration minimum", async () => {
		const { hostFunctions } = createHostFunctions({
			integration: integration({ minimumProgress: "5" }),
		});

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 3, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({ action: "skip", reason: "below_minimum_progress" });
	});

	it("replaces progress above the integration maximum with 100", async () => {
		const { hostFunctions } = createHostFunctions({
			events: [],
			integration: integration({ maximumProgress: "95" }),
		});

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 97, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({
			action: "replace",
			body: { properties: { progressPercent: 100, consumedOn: "Plex" } },
		});
	});

	it("skips duplicate progress at the same percentage for the same identity", async () => {
		const { hostFunctions } = createHostFunctions({
			integration: integration(),
			events: [
				{ occurredAt: minutesAgo(5), properties: { progressPercent: 35, consumedOn: "Plex" } },
			],
		});

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 35, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({ action: "skip", reason: "duplicate_progress" });
	});

	it("does not treat a different identity as a duplicate", async () => {
		const { hostFunctions } = createHostFunctions({
			integration: integration(),
			events: [
				{ occurredAt: minutesAgo(5), properties: { progressPercent: 35, consumedOn: "Netflix" } },
			],
		});

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 35, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({ action: "allow" });
	});

	it("skips a completion when a recent completion exists within the threshold", async () => {
		const { hostFunctions } = createHostFunctions({
			integration: integration(),
			events: [
				{ occurredAt: minutesAgo(1), properties: { progressPercent: 50, consumedOn: "Plex" } },
				{ occurredAt: minutesAgo(30), properties: { progressPercent: 100, consumedOn: "Plex" } },
			],
		});

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 100, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsFalse },
		);

		expect(result).toEqual({ action: "skip", reason: "completed_recently" });
	});

	it("allows a completion when the prior completion is outside the threshold", async () => {
		const { hostFunctions } = createHostFunctions({
			thresholdHours: "2",
			integration: integration({ maximumProgress: "100" }),
			events: [
				{ occurredAt: minutesAgo(10), properties: { progressPercent: 50, consumedOn: "Plex" } },
				{ occurredAt: minutesAgo(180), properties: { progressPercent: 100, consumedOn: "Plex" } },
			],
		});

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 100, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsFalse },
		);

		expect(result).toEqual({ action: "allow" });
	});

	it("allows in-range progress with no matching prior events", async () => {
		const { hostFunctions } = createHostFunctions({
			events: [],
			integration: integration(),
		});

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 42, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({ action: "allow" });
	});
});
