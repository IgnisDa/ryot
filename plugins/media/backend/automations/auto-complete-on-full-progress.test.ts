import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import type { CreateEventItem } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import {
	eventAutomationContext,
	entityRecord,
	eventRecord,
	execution,
	hostSuccess,
	ryotqlRows,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./auto-complete-on-full-progress.sandbox";

const completeSchema = {
	name: "Complete",
	slug: "complete",
	propertiesSchema: {},
	id: "complete-schema",
	entitySchemaSlug: "entity-schema-1",
};

const createHost = (options: {
	entityProperties?: JsonValue;
	events?: ReturnType<typeof eventRecord>[];
	eventPages?: ReturnType<typeof eventRecord>[][];
}) => {
	const created: (readonly CreateEventItem[])[] = [];
	const documents: unknown[] = [];
	let queryIndex = 0;
	return {
		created,
		documents,
		host: defineSandboxTestHost(manifest, {
			listEventSchemas: () => hostSuccess([completeSchema]),
			createEvents: (items) => {
				created.push(items);
				return hostSuccess({ count: items.length });
			},
			executeRyotql: (document) => {
				documents.push(document);
				const index = queryIndex++;
				const eventPages = options.eventPages ?? [options.events ?? []];
				const eventPageIndex = index - 1;
				return hostSuccess(
					ryotqlRows(
						index === 0 ? "entities" : "events",
						index === 0
							? [entityRecord({ properties: options.entityProperties ?? {} })]
							: (eventPages[eventPageIndex] ?? []),
						index === 0
							? { hasMore: false, nextCursor: null }
							: {
									hasMore: eventPageIndex < eventPages.length - 1,
									nextCursor:
										eventPageIndex < eventPages.length - 1 ? `events-${eventPageIndex + 1}` : null,
								},
					),
				);
			},
		}),
	};
};

const run = (context: AutomationInput, host: ReturnType<typeof createHost>["host"]) =>
	definition.run(context, host, execution);

describe("auto-complete-on-full-progress sandbox script", () => {
	it("ignores progress events below full completion", () => {
		const { created, host } = createHost({});
		return Effect.runPromise(
			run(eventAutomationContext({ properties: { progressPercent: 50 } }), host).pipe(
				Effect.map((result) => {
					expect(result).toBeNull();
					expect(created).toEqual([]);
					return undefined;
				}),
			),
		);
	});

	it("completes non-episodic media at the progress event timestamp", () => {
		const { created, host } = createHost({});
		return Effect.runPromise(
			run(
				eventAutomationContext(
					{
						occurredAt: "2026-02-03T04:05:06.000Z",
						properties: { progressPercent: 100, consumedOn: "Jellyfin" },
					},
					{ inheritedProperties: ["consumedOn"] },
				),
				host,
			).pipe(
				Effect.map(() => {
					expect(created).toEqual([
						[
							{
								entityId: "entity-1",
								eventSchemaSlug: "complete-schema",
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
				}),
			),
		);
	});

	it.each(["show-episode", "podcast-episode"] as const)(
		"copies the session entity to a %s completion event",
		(entitySchemaSlug) => {
			const { created, host } = createHost({});
			return Effect.runPromise(
				run(
					eventAutomationContext({
						sessionEntityId: "parent-1",
						properties: { progressPercent: 100 },
						subject: { id: "entity-1", name: "Episode", entitySchemaSlug },
					}),
					host,
				).pipe(
					Effect.map(() => {
						expect(created[0]?.[0]).toMatchObject({ sessionEntityId: "parent-1" });
						return undefined;
					}),
				),
			);
		},
	);

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
		return Effect.runPromise(
			Effect.all(
				[
					run(
						eventAutomationContext({
							id: "episode-2",
							properties: { progressPercent: 100, animeEpisode: 2 },
							subject: { id: "entity-1", name: "Anime", entitySchemaSlug: "anime" },
						}),
						complete.host,
					),
					run(
						eventAutomationContext({
							id: "episode-1",
							properties: { progressPercent: 100, animeEpisode: 1 },
							subject: { id: "entity-1", name: "Anime", entitySchemaSlug: "anime" },
						}),
						incomplete.host,
					),
				],
				{ concurrency: "unbounded" },
			).pipe(
				Effect.map(() => {
					expect(complete.created).toHaveLength(1);
					expect(incomplete.created).toHaveLength(0);
					return undefined;
				}),
			),
		);
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
		return Effect.runPromise(
			run(
				eventAutomationContext({
					id: "chapter-2b",
					properties: { progressPercent: 100, mangaChapter: 2 },
					subject: { id: "entity-1", name: "Manga", entitySchemaSlug: "manga" },
				}),
				host,
			).pipe(
				Effect.map(() => {
					expect(created).toHaveLength(1);
					return undefined;
				}),
			),
		);
	});

	it("combines every progress event page before checking coverage", () => {
		const firstPage = Array.from({ length: 100 }, (_, index) =>
			eventRecord({
				id: `episode-${index + 1}`,
				properties: { progressPercent: 100, animeEpisode: index + 1 },
				occurredAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
			}),
		);
		const finalEvent = eventRecord({
			id: "episode-101",
			properties: { progressPercent: 100, animeEpisode: 101 },
			occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 100)).toISOString(),
		});
		const { created, documents, host } = createHost({
			entityProperties: { episodes: 101 },
			eventPages: [firstPage, [finalEvent]],
		});
		return Effect.runPromise(
			run(
				eventAutomationContext({
					id: finalEvent.id,
					properties: { progressPercent: 100, animeEpisode: 101 },
					subject: { id: "entity-1", name: "Anime", entitySchemaSlug: "anime" },
				}),
				host,
			).pipe(
				Effect.map(() => {
					expect(created).toHaveLength(1);
					expect(documents.slice(1)).toMatchObject([
						{ queries: { events: { output: { pagination: {} } } } },
						{
							queries: {
								events: { output: { pagination: { after: "events-1" } } },
							},
						},
					]);
					return undefined;
				}),
			),
		);
	});
});
