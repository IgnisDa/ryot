import type { CreateEventItem, JsonValue } from "@ryot/sandbox-sdk";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import type { AfterCreateTriggerInput } from "@ryot/sandbox-sdk/trigger";
import { describe, expect, it } from "vitest";

import definition, { manifest } from "./auto-complete-on-full-progress.sandbox";
import {
	afterCreateContext,
	entityRecord,
	eventRecord,
	execution,
	hostSuccess,
} from "./test-utils";

const completeSchema = {
	name: "Complete",
	slug: "complete",
	propertiesSchema: {},
	id: "complete-schema",
	entitySchemaId: "entity-schema-1",
};

const createHost = (options: {
	entityProperties?: JsonValue;
	events?: ReturnType<typeof eventRecord>[];
}) => {
	const created: CreateEventItem[][] = [];
	return {
		created,
		host: defineSandboxTestHost(manifest, {
			getEntity: () => hostSuccess(entityRecord({ properties: options.entityProperties ?? {} })),
			listEvents: () => hostSuccess(options.events ?? []),
			listEventSchemas: () => hostSuccess([completeSchema]),
			createEvents: (items) => {
				created.push(items);
				return hostSuccess({ count: items.length });
			},
		}),
	};
};

const run = (context: AfterCreateTriggerInput, host: ReturnType<typeof createHost>["host"]) =>
	runSandboxTestDriver(definition.drivers.trigger, context, host, execution);

describe("auto-complete-on-full-progress sandbox script", () => {
	it("completes non-episodic media at the progress event timestamp", () => {
		const { created, host } = createHost({});
		return run(
			afterCreateContext({
				occurredAt: "2026-02-03T04:05:06.000Z",
				properties: { progressPercent: 100 },
				inheritedProperties: { consumedOn: "Jellyfin" },
			}),
			host,
		).then(() => {
			expect(created).toEqual([
				[
					{
						entityId: "entity-1",
						eventSchemaId: "complete-schema",
						occurredAt: "2026-02-03T04:05:06.000Z",
						properties: {
							consumedOn: "Jellyfin",
							completionMode: "custom_timestamps",
							completedOn: "2026-02-03T04:05:06.000Z",
						},
					},
				],
			]);
			return undefined;
		});
	});

	it("waits for complete anime coverage and emits on the completing episode", () => {
		const events = [
			eventRecord({
				id: "episode-1",
				occurredAt: "2026-01-01T00:00:00.000Z",
				properties: { progressPercent: 100, animeEpisode: 1 },
			}),
			eventRecord({
				id: "episode-2",
				occurredAt: "2026-01-02T00:00:00.000Z",
				properties: { progressPercent: 100, animeEpisode: 2 },
			}),
		];
		const complete = createHost({ events, entityProperties: { episodes: 2 } });
		const incomplete = createHost({
			events: events.slice(0, 1),
			entityProperties: { episodes: 2 },
		});
		return Promise.all([
			run(
				afterCreateContext({
					eventId: "episode-2",
					entitySchemaSlug: "anime",
					properties: { progressPercent: 100, animeEpisode: 2 },
				}),
				complete.host,
			),
			run(
				afterCreateContext({
					eventId: "episode-1",
					entitySchemaSlug: "anime",
					properties: { progressPercent: 100, animeEpisode: 1 },
				}),
				incomplete.host,
			),
		]).then(() => {
			expect(complete.created).toHaveLength(1);
			expect(incomplete.created).toHaveLength(0);
			return undefined;
		});
	});

	it("supports manga coverage and repeated completion passes", () => {
		const events = [
			eventRecord({
				id: "chapter-1a",
				occurredAt: "2026-01-01T00:00:00.000Z",
				properties: { progressPercent: 100, mangaChapter: 1 },
			}),
			eventRecord({
				id: "chapter-2a",
				occurredAt: "2026-01-02T00:00:00.000Z",
				properties: { progressPercent: 100, mangaChapter: 2 },
			}),
			eventRecord({
				id: "chapter-1b",
				occurredAt: "2026-01-03T00:00:00.000Z",
				properties: { progressPercent: 100, mangaChapter: 1 },
			}),
			eventRecord({
				id: "chapter-2b",
				occurredAt: "2026-01-04T00:00:00.000Z",
				properties: { progressPercent: 100, mangaChapter: 2 },
			}),
		];
		const { created, host } = createHost({ events, entityProperties: { chapters: 2 } });
		return run(
			afterCreateContext({
				eventId: "chapter-2b",
				entitySchemaSlug: "manga",
				properties: { progressPercent: 100, mangaChapter: 2 },
			}),
			host,
		).then(() => {
			expect(created).toHaveLength(1);
			return undefined;
		});
	});
});
