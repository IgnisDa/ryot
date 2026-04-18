import { describe, expect, it } from "bun:test";

import integrationProgressPolicyScriptCode from "./integration-progress-policy.txt";
import { appApiFailure, appApiSuccess, runTriggerScript } from "./test-utils";

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

const createAppApiCall = (options: {
	events?: EventFixture[];
	thresholdHours?: string | number | null;
	integration?: Record<string, unknown> | null;
}) => {
	const calls: Array<{ method: string; path: string }> = [];
	const appApiCall = (method: unknown, path: unknown) => {
		const stringPath = String(path);
		calls.push({ method: String(method), path: stringPath });

		if (stringPath.startsWith("/api/integrations/")) {
			return options.integration ? appApiSuccess(options.integration) : appApiFailure();
		}
		if (stringPath.startsWith("/api/events")) {
			return appApiSuccess(options.events ?? []);
		}
		if (stringPath === "/api/system/config") {
			return appApiSuccess({
				system: { scheduler: { progressUpdateThresholdHours: options.thresholdHours ?? "2" } },
			});
		}
		return appApiFailure();
	};

	return { appApiCall, calls };
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
		const { appApiCall, calls } = createAppApiCall({ integration: integration() });

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ origin: "api" }),
			{ appApiCall, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({ action: "allow" });
		expect(calls).toHaveLength(0);
	});

	it("skips when progressPercent cannot be parsed", async () => {
		const { appApiCall, calls } = createAppApiCall({ integration: integration() });

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: "not-a-number", consumedOn: "Plex" } }),
			{ appApiCall, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({ action: "skip", reason: "invalid_progress" });
		expect(calls).toHaveLength(0);
	});

	it("skips progress below the integration minimum", async () => {
		const { appApiCall } = createAppApiCall({ integration: integration({ minimumProgress: "5" }) });

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 3, consumedOn: "Plex" } }),
			{ appApiCall, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({ action: "skip", reason: "below_minimum_progress" });
	});

	it("replaces progress above the integration maximum with 100", async () => {
		const { appApiCall } = createAppApiCall({
			events: [],
			integration: integration({ maximumProgress: "95" }),
		});

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 97, consumedOn: "Plex" } }),
			{ appApiCall, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({
			action: "replace",
			body: { properties: { progressPercent: 100, consumedOn: "Plex" } },
		});
	});

	it("skips duplicate progress at the same percentage for the same identity", async () => {
		const { appApiCall } = createAppApiCall({
			integration: integration(),
			events: [
				{ occurredAt: minutesAgo(5), properties: { progressPercent: 35, consumedOn: "Plex" } },
			],
		});

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 35, consumedOn: "Plex" } }),
			{ appApiCall, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({ action: "skip", reason: "duplicate_progress" });
	});

	it("does not treat a different identity as a duplicate", async () => {
		const { appApiCall } = createAppApiCall({
			integration: integration(),
			events: [
				{ occurredAt: minutesAgo(5), properties: { progressPercent: 35, consumedOn: "Netflix" } },
			],
		});

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 35, consumedOn: "Plex" } }),
			{ appApiCall, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({ action: "allow" });
	});

	it("skips a completion when a recent completion exists within the threshold", async () => {
		const { appApiCall } = createAppApiCall({
			integration: integration(),
			events: [
				{ occurredAt: minutesAgo(1), properties: { progressPercent: 50, consumedOn: "Plex" } },
				{ occurredAt: minutesAgo(30), properties: { progressPercent: 100, consumedOn: "Plex" } },
			],
		});

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 100, consumedOn: "Plex" } }),
			{ appApiCall, claimCachedValue: claimsFalse },
		);

		expect(result).toEqual({ action: "skip", reason: "completed_recently" });
	});

	it("allows a completion when the prior completion is outside the threshold", async () => {
		const { appApiCall } = createAppApiCall({
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
			{ appApiCall, claimCachedValue: claimsFalse },
		);

		expect(result).toEqual({ action: "allow" });
	});

	it("allows in-range progress with no matching prior events", async () => {
		const { appApiCall } = createAppApiCall({ events: [], integration: integration() });

		const result = await runTriggerScript(
			integrationProgressPolicyScriptCode,
			createTrigger({ properties: { progressPercent: 42, consumedOn: "Plex" } }),
			{ appApiCall, claimCachedValue: claimsTrue },
		);

		expect(result).toEqual({ action: "allow" });
	});
});
