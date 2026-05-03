import type { AutomationPolicyInput } from "@ryot/sandbox-sdk/automation";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import {
	policyAutomationContext,
	eventRecord,
	execution,
	hostFailure,
	hostSuccess,
	integrationRecord,
	queryEngineRows,
} from "./automation-test-utils";
import definition, { manifest } from "./integration-progress-policy.sandbox";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const createPolicyContext = (
	overrides: Partial<AutomationPolicyInput["automation"]["source"]["draft"]> = {},
	origin?: AutomationPolicyInput["automation"]["origin"],
) =>
	policyAutomationContext(
		{
			properties: { progressPercent: 50, consumedOn: "Plex" },
			...overrides,
		},
		origin,
	);

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
			getCurrentIntegration: () => {
				calls.push("getCurrentIntegration");
				return options.integration ? hostSuccess(options.integration) : hostFailure();
			},
			executeQueryEngine: () => {
				calls.push("executeQueryEngine");
				return hostSuccess(queryEngineRows(options.events ?? []));
			},
			getPluginConfig: (keys) => {
				calls.push("getPluginConfig");
				return hostSuccess(
					Object.fromEntries(keys.map((key) => [key, options.thresholdHours ?? "2"])),
				);
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

const run = (context: AutomationPolicyInput, host: ReturnType<typeof createHost>["host"]) =>
	definition.run(context, host, execution);

describe("integration-progress-policy sandbox script", () => {
	it("allows non-integration events immediately without host calls", () => {
		const { calls, host } = createHost({ integration: integrationRecord() });
		return Effect.runPromise(
			run(createPolicyContext({}, { kind: "api" }), host).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ action: "allow" });
					expect(calls).toHaveLength(0);
					return undefined;
				}),
			),
		);
	});

	it("skips invalid progress and progress below the integration minimum", () => {
		const { host } = createHost({ integration: integrationRecord({ minimumProgress: 5 }) });
		return Effect.runPromise(
			Effect.all(
				[
					run(createPolicyContext({ properties: { progressPercent: "not-a-number" } }), host),
					run(
						createPolicyContext({ properties: { progressPercent: 3, consumedOn: "Plex" } }),
						host,
					),
				],
				{ concurrency: "unbounded" },
			).pipe(
				Effect.map(([invalid, belowMinimum]) => {
					expect(invalid).toEqual({ action: "skip", reason: "invalid_progress" });
					expect(belowMinimum).toEqual({ action: "skip", reason: "below_minimum_progress" });
					return undefined;
				}),
			),
		);
	});

	it("replaces progress above the integration maximum with 100", () => {
		const { host } = createHost({ integration: integrationRecord({ maximumProgress: 95 }) });
		return Effect.runPromise(
			run(
				createPolicyContext({ properties: { progressPercent: 97, consumedOn: "Plex" } }),
				host,
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						action: "replace",
						body: { properties: { progressPercent: 100, consumedOn: "Plex" } },
					});
					return undefined;
				}),
			),
		);
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
		return Effect.runPromise(
			Effect.all(
				[
					run(
						createPolicyContext({
							entitySchemaSlug: "anime",
							properties: { animeEpisode: 1, consumedOn: "AniList", progressPercent: 35 },
						}),
						host,
					),
					run(
						createPolicyContext({
							entitySchemaSlug: "anime",
							properties: { animeEpisode: 2, consumedOn: "AniList", progressPercent: 35 },
						}),
						host,
					),
				],
				{ concurrency: "unbounded" },
			).pipe(
				Effect.map(([duplicate, distinct]) => {
					expect(duplicate).toEqual({ action: "skip", reason: "duplicate_progress" });
					expect(distinct).toEqual({ action: "allow" });
					return undefined;
				}),
			),
		);
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

		return Effect.runPromise(
			Effect.all(
				[
					run(
						createPolicyContext({ properties: { progressPercent: 100, consumedOn: "Plex" } }),
						recent.host,
					),
					run(
						createPolicyContext({ properties: { progressPercent: 100, consumedOn: "Plex" } }),
						old.host,
					),
				],
				{ concurrency: "unbounded" },
			).pipe(
				Effect.map(([recentResult, oldResult]) => {
					expect(recentResult).toEqual({ action: "skip", reason: "completed_recently" });
					expect(oldResult).toEqual({ action: "allow" });
					return undefined;
				}),
			),
		);
	});
});
