import type { LogEntry } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";
import { expect, it } from "vitest";

import {
	eventRecord,
	hostSuccess,
	integrationRecord,
	ryotqlRows,
} from "../../tests/backend/automations/automation-test-utils";
import { createMediaImportChunk } from "./chunks";
import { admitIntegrationProgress } from "./integration-progress";
import type { MediaImportWriteChunkInput } from "./schemas";
import { manifest } from "./write-chunks.sandbox";

const input = (
	properties: Readonly<Record<string, JsonValue>> = { consumedOn: "Plex", progressPercent: 50 },
	event: Partial<MediaImportWriteChunkInput["entityGroups"][number]["events"][number]> = {},
): MediaImportWriteChunkInput => ({
	failures: [],
	integration: { importRunId: "run-1", integrationId: "integration-1" },
	populationResults: [{ index: 0, entityId: "movie-1", status: "completed" }],
	entityGroups: [
		{
			itemIndex: 7,
			collectionMemberships: [],
			events: [
				{
					properties,
					eventSchemaSlug: "progress",
					occurredAt: "2026-01-01T00:00:00.000Z",
					...event,
				},
			],
			entityRef: {
				kind: "resolved",
				externalId: "42",
				sourceLabel: "Movie",
				entitySchemaSlug: "movie",
				providerSlug: "movie.tmdb",
			},
		},
	],
});

const createHost = (
	options: {
		minimum?: number;
		maximum?: number;
		threshold?: JsonValue;
		claimed?: boolean;
		events?: ReturnType<typeof eventRecord>[];
	} = {},
) => {
	const calls: string[] = [];
	const queries: JsonValue[] = [];
	const claims: { key: string; value: JsonValue; ttl: number }[] = [];
	const logs: LogEntry[] = [];
	const host = defineSandboxTestHost(manifest, {
		log: (entries) => {
			logs.push(...entries);
			return hostSuccess(null);
		},
		getPluginConfig: () => {
			calls.push("config");
			return hostSuccess({ progressUpdateThresholdHours: options.threshold ?? 2 });
		},
		executeRyotql: (query) => {
			calls.push("query");
			queries.push(query);
			return hostSuccess(ryotqlRows("events", options.events ?? []));
		},
		getCurrentIntegration: () => {
			calls.push("integration");
			return hostSuccess(
				integrationRecord({
					minimumProgress: options.minimum ?? 0,
					maximumProgress: options.maximum ?? 100,
				}),
			);
		},
		claimPersistentValue: (key, value, ttl) => {
			claims.push({ key, ttl, value });
			return hostSuccess(
				options.claimed === false
					? { value: null, claimed: false as const }
					: { claimed: true as const },
			);
		},
	});
	return { host, logs, calls, claims, queries };
};

it("leaves ordinary imports and non-progress events untouched without admission calls", async () => {
	const { host, logs, calls } = createHost();
	const ordinary = { ...input(), integration: undefined };
	expect(await Effect.runPromise(admitIntegrationProgress(ordinary, host))).toEqual(ordinary);
	const nonProgress = input({}, { eventSchemaSlug: "review" });
	expect(await Effect.runPromise(admitIntegrationProgress(nonProgress, host))).toEqual(nonProgress);
	expect(calls).toEqual([]);
	expect(logs).toEqual([]);
});

it.each(["not-a-number", "", 3])(
	"omits invalid or below-minimum progress %s from import writes",
	async (progressPercent) => {
		const { host, logs, calls } = createHost({ minimum: 5 });
		const admitted = await Effect.runPromise(
			admitIntegrationProgress(input({ progressPercent }), host),
		);
		const chunk = createMediaImportChunk(admitted, "2026-01-01T00:00:00.000Z");
		expect(chunk.items[0]?.events).toEqual([]);
		expect(chunk.items[0]?.relationships).toHaveLength(1);
		expect(calls).not.toContain("query");
		expect(logs[0]?.attributes).toMatchObject({
			itemIndex: 7,
			importRunId: "run-1",
			integrationId: "integration-1",
			reason: progressPercent === 3 ? "below_minimum_progress" : "invalid_progress",
		});
	},
);

it("clamps above maximum to completion while preserving unmodified numeric representations and timestamps", async () => {
	const { host, claims } = createHost({ maximum: 95 });
	const normalized = await Effect.runPromise(
		admitIntegrationProgress(input({ consumedOn: "Plex", progressPercent: 97 }), host),
	);
	expect(normalized.entityGroups[0]?.events[0]).toEqual({
		eventSchemaSlug: "progress",
		occurredAt: "2026-01-01T00:00:00.000Z",
		properties: { consumedOn: "Plex", progressPercent: 100 },
	});
	await Promise.all(
		[95, "35.555", 35.555].map(async (progressPercent) => {
			const original = input({ progressPercent });
			expect(await Effect.runPromise(admitIntegrationProgress(original, host))).toEqual(original);
		}),
	);
	expect(claims).toEqual([
		{
			ttl: 7200,
			value: true,
			key: '["media.integration-progress.v1","integration-1","movie-1","movie","progress","Plex",""]',
		},
	]);
});

it("compares the latest matching consumption/subitem identity and suppresses duplicates within a produced batch", async () => {
	const { host } = createHost({
		events: [
			eventRecord({
				occurredAt: "2026-01-01T00:00:00.000Z",
				properties: { animeEpisode: 1, consumedOn: "Plex", progressPercent: 35 },
			}),
			eventRecord({
				occurredAt: "2026-01-02T00:00:00.000Z",
				properties: { animeEpisode: 1, consumedOn: "Other", progressPercent: 50 },
			}),
		],
	});
	const duplicate = await Effect.runPromise(
		admitIntegrationProgress(
			input({ animeEpisode: "1", consumedOn: "Plex", progressPercent: "35" }),
			host,
		),
	);
	expect(duplicate.entityGroups[0]?.events).toEqual([]);
	const distinctProperties: Readonly<Record<string, JsonValue>>[] = [
		{ animeEpisode: 1, consumedOn: "Other", progressPercent: 35 },
		{ animeEpisode: 2, consumedOn: "Plex", progressPercent: 35 },
		{ mangaVolume: 1, mangaChapter: 1, consumedOn: "Plex", progressPercent: 35 },
	];
	await Promise.all(
		distinctProperties.map(async (properties) => {
			const original = input(properties, { occurredAt: "2026-01-03T00:00:00.000Z" });
			const repeated = {
				...original,
				entityGroups: original.entityGroups.map((group) => ({
					...group,
					events: [...group.events, ...group.events],
				})),
			};
			expect(await Effect.runPromise(admitIntegrationProgress(repeated, host))).toEqual(original);
		}),
	);
});

it.each([
	{ ttl: 7200, minutes: 30, threshold: 2, claimed: false, suppressed: true },
	{ ttl: 7200, minutes: 180, threshold: 2, claimed: false, suppressed: false },
	{ ttl: 7200, minutes: 30, threshold: 2, claimed: true, suppressed: false },
	{ ttl: 3600, minutes: 90, claimed: false, threshold: "1", suppressed: false },
	{ ttl: 7200, minutes: 30, claimed: false, suppressed: true, threshold: "invalid" },
	{ ttl: 7200, minutes: 30, threshold: 0, claimed: false, suppressed: true },
])(
	"preserves completion claim/history behavior: $minutes minutes, claimed $claimed, threshold $threshold",
	async ({ ttl, minutes, claimed, threshold, suppressed }) => {
		const now = Date.now();
		const { host, claims } = createHost({
			claimed,
			threshold,
			events: [
				eventRecord({
					properties: { consumedOn: "Plex", progressPercent: 100 },
					occurredAt: new Date(now - minutes * 60_000).toISOString(),
				}),
				eventRecord({
					occurredAt: new Date(now - 60_000).toISOString(),
					properties: { consumedOn: "Plex", progressPercent: 50 },
				}),
			],
		});
		const result = await Effect.runPromise(
			admitIntegrationProgress(input({ consumedOn: "Plex", progressPercent: 100 }), host),
		);
		expect(result.entityGroups[0]?.events).toHaveLength(suppressed ? 0 : 1);
		expect(claims[0]?.ttl).toBe(ttl);
	},
);

it("uses the resolved episode identity and stable integration key across import executions", async () => {
	const { host, logs, claims, queries } = createHost();
	const episode = input(
		{ consumedOn: "Plex", progressPercent: 100 },
		{ subjectEntityId: "episode-1", subjectEntitySchemaSlug: "show-episode" },
	);
	await Effect.runPromise(
		Effect.forEach(
			[
				["integration-1", "run-1"],
				["integration-1", "run-2"],
				["integration-2", "run-3"],
			] as const,
			([integrationId, importRunId]) =>
				admitIntegrationProgress({ ...episode, integration: { importRunId, integrationId } }, host),
		),
	);
	expect(JSON.stringify(queries[0])).toContain("episode-1");
	expect(JSON.stringify(queries[0])).toContain("show-episode");
	expect(JSON.stringify(queries[0])).not.toContain("movie-1");
	expect(claims[0]?.key).toBe(
		'["media.integration-progress.v1","integration-1","episode-1","show-episode","progress","Plex",""]',
	);
	expect(claims[1]?.key).toBe(claims[0]?.key);
	expect(claims[2]?.key).not.toBe(claims[0]?.key);
	expect(logs.map((log) => log.attributes?.["importRunId"])).toEqual(["run-1", "run-2", "run-3"]);
});

it("keeps unresolved population failures out of admission", async () => {
	const { host, calls } = createHost();
	const unresolved = { ...input(), populationResults: [] };
	const admitted = await Effect.runPromise(admitIntegrationProgress(unresolved, host));
	expect(createMediaImportChunk(admitted, "2026-01-01T00:00:00.000Z")).toMatchObject({
		items: [],
		failures: [{ stage: "provider_resolution" }],
	});
	expect(calls).toEqual([]);
});
