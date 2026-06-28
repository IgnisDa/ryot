import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import type { BeforeCreateTriggerInput } from "@ryot/sandbox-sdk/trigger";
import { describe, expect, it } from "vitest";

import definition, { manifest } from "./integration-progress-policy.sandbox";
import {
	beforeCreateContext,
	eventRecord,
	execution,
	hostFailure,
	hostSuccess,
	integrationRecord,
} from "./test-utils";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const createTrigger = (
	overrides: Partial<BeforeCreateTriggerInput["trigger"]> = {},
): BeforeCreateTriggerInput =>
	beforeCreateContext({
		properties: { progressPercent: 50, consumedOn: "Plex" },
		...overrides,
	});

const createHost = (options: {
	claimed?: boolean;
	thresholdHours?: string | number | null;
	events?: ReturnType<typeof eventRecord>[];
	integration?: ReturnType<typeof integrationRecord> | null;
}) => {
	const calls: string[] = [];
	return {
		calls,
		host: defineSandboxTestHost(manifest, {
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
			claimCachedValue: () =>
				hostSuccess(
					options.claimed === false
						? { claimed: false as const, value: null }
						: { claimed: true as const },
				),
		}),
	};
};

const run = (context: BeforeCreateTriggerInput, host: ReturnType<typeof createHost>["host"]) =>
	runSandboxTestDriver(definition.drivers.trigger, context, host, execution);

describe("integration-progress-policy sandbox script", () => {
	it("allows non-integration events immediately without host calls", () => {
		const { calls, host } = createHost({ integration: integrationRecord() });
		return run(createTrigger({ origin: "api" }), host).then((result) => {
			expect(result).toEqual({ action: "allow" });
			expect(calls).toHaveLength(0);
			return undefined;
		});
	});

	it("skips invalid progress and progress below the integration minimum", () => {
		const { host } = createHost({ integration: integrationRecord({ minimumProgress: 5 }) });
		return Promise.all([
			run(createTrigger({ properties: { progressPercent: "not-a-number" } }), host),
			run(createTrigger({ properties: { progressPercent: 3, consumedOn: "Plex" } }), host),
		]).then(([invalid, belowMinimum]) => {
			expect(invalid).toEqual({ action: "skip", reason: "invalid_progress" });
			expect(belowMinimum).toEqual({ action: "skip", reason: "below_minimum_progress" });
			return undefined;
		});
	});

	it("replaces progress above the integration maximum with 100", () => {
		const { host } = createHost({ integration: integrationRecord({ maximumProgress: 95 }) });
		return run(
			createTrigger({ properties: { progressPercent: 97, consumedOn: "Plex" } }),
			host,
		).then((result) => {
			expect(result).toEqual({
				action: "replace",
				body: { properties: { progressPercent: 100, consumedOn: "Plex" } },
			});
			return undefined;
		});
	});

	it("suppresses duplicates only for the same progress identity", () => {
		const { host } = createHost({
			integration: integrationRecord(),
			events: [
				eventRecord({
					occurredAt: minutesAgo(5),
					properties: { animeEpisode: 1, consumedOn: "AniList", progressPercent: 35 },
				}),
			],
		});
		return Promise.all([
			run(
				createTrigger({
					entitySchemaSlug: "anime",
					properties: { animeEpisode: 1, consumedOn: "AniList", progressPercent: 35 },
				}),
				host,
			),
			run(
				createTrigger({
					entitySchemaSlug: "anime",
					properties: { animeEpisode: 2, consumedOn: "AniList", progressPercent: 35 },
				}),
				host,
			),
		]).then(([duplicate, distinct]) => {
			expect(duplicate).toEqual({ action: "skip", reason: "duplicate_progress" });
			expect(distinct).toEqual({ action: "allow" });
			return undefined;
		});
	});

	it("debounces recent completions and allows completions outside the threshold", () => {
		const recent = createHost({
			claimed: false,
			integration: integrationRecord({ maximumProgress: 100 }),
			events: [
				eventRecord({
					id: "event-latest",
					occurredAt: minutesAgo(1),
					properties: { progressPercent: 50, consumedOn: "Plex" },
				}),
				eventRecord({
					id: "event-complete",
					occurredAt: minutesAgo(30),
					properties: { progressPercent: 100, consumedOn: "Plex" },
				}),
			],
		});
		const old = createHost({
			claimed: false,
			thresholdHours: 2,
			integration: integrationRecord({ maximumProgress: 100 }),
			events: [
				eventRecord({
					id: "event-latest",
					occurredAt: minutesAgo(10),
					properties: { progressPercent: 50, consumedOn: "Plex" },
				}),
				eventRecord({
					id: "event-complete",
					occurredAt: minutesAgo(180),
					properties: { progressPercent: 100, consumedOn: "Plex" },
				}),
			],
		});

		return Promise.all([
			run(createTrigger({ properties: { progressPercent: 100, consumedOn: "Plex" } }), recent.host),
			run(createTrigger({ properties: { progressPercent: 100, consumedOn: "Plex" } }), old.host),
		]).then(([recentResult, oldResult]) => {
			expect(recentResult).toEqual({ action: "skip", reason: "completed_recently" });
			expect(oldResult).toEqual({ action: "allow" });
			return undefined;
		});
	});
});
