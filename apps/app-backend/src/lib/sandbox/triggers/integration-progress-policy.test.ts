import { describe, expect, it } from "vitest";

import { hostFailure, hostSuccess, readScriptFile, runTriggerScript } from "./test-utils";

const getIntegrationProgressPolicyScriptCode = () =>
	readScriptFile("./integration-progress-policy.txt");

const runIntegrationProgressPolicyScript = (
	context: unknown,
	hostFunctions: Record<string, (...args: Array<unknown>) => unknown>,
) =>
	getIntegrationProgressPolicyScriptCode().then((code) =>
		runTriggerScript(code, context, hostFunctions),
	);

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
			getAppConfigValue: () => {
				calls.push("getAppConfigValue");
				return hostSuccess(options.thresholdHours ?? "2");
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
	it("allows non-integration events immediately without any API calls", () => {
		const { calls, hostFunctions } = createHostFunctions({ integration: integration() });

		return runIntegrationProgressPolicyScript(createTrigger({ origin: "api" }), {
			...hostFunctions,
			claimCachedValue: claimsTrue,
		}).then((result) => {
			expect(result).toEqual({ action: "allow" });
			expect(calls).toHaveLength(0);
			return undefined;
		});
	});

	it("skips when progressPercent cannot be parsed", () => {
		const { calls, hostFunctions } = createHostFunctions({ integration: integration() });

		return runIntegrationProgressPolicyScript(
			createTrigger({ properties: { progressPercent: "not-a-number", consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		).then((result) => {
			expect(result).toEqual({ action: "skip", reason: "invalid_progress" });
			expect(calls).toHaveLength(0);
			return undefined;
		});
	});

	it("skips progress below the integration minimum", () => {
		const { hostFunctions } = createHostFunctions({
			integration: integration({ minimumProgress: "5" }),
		});

		return runIntegrationProgressPolicyScript(
			createTrigger({ properties: { progressPercent: 3, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		).then((result) => {
			expect(result).toEqual({ action: "skip", reason: "below_minimum_progress" });
			return undefined;
		});
	});

	it("replaces progress above the integration maximum with 100", () => {
		const { hostFunctions } = createHostFunctions({
			events: [],
			integration: integration({ maximumProgress: "95" }),
		});

		return runIntegrationProgressPolicyScript(
			createTrigger({ properties: { progressPercent: 97, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		).then((result) => {
			expect(result).toEqual({
				action: "replace",
				body: { properties: { progressPercent: 100, consumedOn: "Plex" } },
			});
			return undefined;
		});
	});

	it("skips duplicate progress at the same percentage for the same identity", () => {
		const { hostFunctions } = createHostFunctions({
			integration: integration(),
			events: [
				{ occurredAt: minutesAgo(5), properties: { progressPercent: 35, consumedOn: "Plex" } },
			],
		});

		return runIntegrationProgressPolicyScript(
			createTrigger({ properties: { progressPercent: 35, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		).then((result) => {
			expect(result).toEqual({ action: "skip", reason: "duplicate_progress" });
			return undefined;
		});
	});

	it("does not treat a different identity as a duplicate", () => {
		const { hostFunctions } = createHostFunctions({
			integration: integration(),
			events: [
				{ occurredAt: minutesAgo(5), properties: { progressPercent: 35, consumedOn: "Netflix" } },
			],
		});

		return runIntegrationProgressPolicyScript(
			createTrigger({ properties: { progressPercent: 35, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		).then((result) => {
			expect(result).toEqual({ action: "allow" });
			return undefined;
		});
	});

	it("skips a completion when a recent completion exists within the threshold", () => {
		const { hostFunctions } = createHostFunctions({
			integration: integration(),
			events: [
				{ occurredAt: minutesAgo(1), properties: { progressPercent: 50, consumedOn: "Plex" } },
				{ occurredAt: minutesAgo(30), properties: { progressPercent: 100, consumedOn: "Plex" } },
			],
		});

		return runIntegrationProgressPolicyScript(
			createTrigger({ properties: { progressPercent: 100, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsFalse },
		).then((result) => {
			expect(result).toEqual({ action: "skip", reason: "completed_recently" });
			return undefined;
		});
	});

	it("allows a completion when the prior completion is outside the threshold", () => {
		const { hostFunctions } = createHostFunctions({
			thresholdHours: "2",
			integration: integration({ maximumProgress: "100" }),
			events: [
				{ occurredAt: minutesAgo(10), properties: { progressPercent: 50, consumedOn: "Plex" } },
				{ occurredAt: minutesAgo(180), properties: { progressPercent: 100, consumedOn: "Plex" } },
			],
		});

		return runIntegrationProgressPolicyScript(
			createTrigger({ properties: { progressPercent: 100, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsFalse },
		).then((result) => {
			expect(result).toEqual({ action: "allow" });
			return undefined;
		});
	});

	it("allows in-range progress with no matching prior events", () => {
		const { hostFunctions } = createHostFunctions({ events: [], integration: integration() });

		return runIntegrationProgressPolicyScript(
			createTrigger({ properties: { progressPercent: 42, consumedOn: "Plex" } }),
			{ ...hostFunctions, claimCachedValue: claimsTrue },
		).then((result) => {
			expect(result).toEqual({ action: "allow" });
			return undefined;
		});
	});
});
