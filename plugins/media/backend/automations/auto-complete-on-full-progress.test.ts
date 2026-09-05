import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import type { CreateEventItem } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import type { RyotQLDocument } from "@ryot-app/sandbox-sdk/ryotql";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import {
	eventAutomationContext,
	entityRecord,
	eventRecord,
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
	const documents: RyotQLDocument[] = [];
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
				const eventPages = options.eventPages ?? [options.events ?? []];
				const isEntityQuery = "entities" in document.queries;
				const eventPageIndex = queryIndex;
				if (!isEntityQuery) {
					queryIndex += 1;
				}
				return hostSuccess(
					ryotqlRows(
						isEntityQuery ? "entities" : "events",
						isEntityQuery
							? [entityRecord({ properties: options.entityProperties ?? {} })]
							: (eventPages[eventPageIndex] ?? []),
						isEntityQuery
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

const run = (context: AutomationInput, host: ReturnType<typeof createHost>["host"]) => {
	const payload = context.automation.payload;
	const input =
		payload.category === "change" && payload.resource === "event" && payload.operation === "create"
			? {
					...context,
					automation: {
						...context.automation,
						payload: {
							items: [payload],
							resource: "event" as const,
							category: "change" as const,
							operation: "batch" as const,
						},
					},
				}
			: context;
	return definition.run(input, host);
};

const eventBatch = (first: AutomationInput, second: AutomationInput): AutomationInput => {
	const left = first.automation.payload;
	const right = second.automation.payload;
	if (
		left.category !== "change" ||
		left.resource !== "event" ||
		left.operation !== "create" ||
		right.category !== "change" ||
		right.resource !== "event" ||
		right.operation !== "create"
	) {
		throw new Error("Expected event create changes");
	}
	return {
		...first,
		automation: {
			...first.automation,
			payload: { resource: "event", category: "change", operation: "batch", items: [left, right] },
		},
	};
};

describe("auto-complete-on-full-progress sandbox script", () => {
	it("ignores progress events below full completion", () => {
		const { host, created } = createHost({});
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
		const { host, created } = createHost({});
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

	it("submits one ordered request for multiple completions of the same entity", () => {
		const { host, created } = createHost({});
		return Effect.runPromise(
			run(
				eventBatch(
					eventAutomationContext(
						{
							id: "first",
							occurredAt: "2026-02-03T04:05:06.000Z",
							properties: { consumedOn: "Plex", progressPercent: 100 },
						},
						{ inheritedProperties: ["consumedOn"] },
					),
					eventAutomationContext({
						id: "second",
						occurredAt: "2026-02-04T04:05:06.000Z",
						properties: { progressPercent: 100, consumedOn: "Jellyfin" },
					}),
				),
				host,
			).pipe(
				Effect.map(() => {
					expect(created).toHaveLength(1);
					expect(created[0]).toMatchObject([
						{
							occurredAt: "2026-02-03T04:05:06.000Z",
							properties: { consumedOn: "Plex", completedOn: "2026-02-03T04:05:06.000Z" },
						},
						{
							occurredAt: "2026-02-04T04:05:06.000Z",
							properties: { consumedOn: "Jellyfin", completedOn: "2026-02-04T04:05:06.000Z" },
						},
					]);
				}),
			),
		);
	});

	it.each(["show-episode", "podcast-episode"] as const)(
		"copies the session entity to a %s completion event",
		(entitySchemaSlug) => {
			const { host, created } = createHost({});
			return Effect.runPromise(
				run(
					eventAutomationContext({
						entitySchemaSlug,
						entityId: "entity-1",
						sessionEntityId: "parent-1",
						properties: { progressPercent: 100 },
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
				properties: { animeEpisode: 1, progressPercent: 100 },
			}),
			eventRecord({
				id: "episode-2",
				occurredAt: "2026-01-02T00:00:00.000Z",
				properties: { animeEpisode: 2, progressPercent: 100 },
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
							entityId: "entity-1",
							entitySchemaSlug: "anime",
							properties: { animeEpisode: 2, progressPercent: 100 },
						}),
						complete.host,
					),
					run(
						eventAutomationContext({
							id: "episode-1",
							entityId: "entity-1",
							entitySchemaSlug: "anime",
							properties: { animeEpisode: 1, progressPercent: 100 },
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

	it("submits distinct manga coverage passes together when both close in one batch", () => {
		const events = [
			eventRecord({
				id: "chapter-1a",
				occurredAt: "2026-01-01T00:00:00.000Z",
				properties: { mangaChapter: 1, progressPercent: 100 },
			}),
			eventRecord({
				id: "chapter-2a",
				occurredAt: "2026-01-02T00:00:00.000Z",
				properties: { mangaChapter: 2, progressPercent: 100 },
			}),
			eventRecord({
				id: "chapter-1b",
				occurredAt: "2026-01-03T00:00:00.000Z",
				properties: { mangaChapter: 1, progressPercent: 100 },
			}),
			eventRecord({
				id: "chapter-2b",
				occurredAt: "2026-01-04T00:00:00.000Z",
				properties: { mangaChapter: 2, progressPercent: 100 },
			}),
		];
		const { host, created } = createHost({ events, entityProperties: { chapters: 2 } });
		return Effect.runPromise(
			run(
				eventBatch(
					eventAutomationContext({
						id: "chapter-2a",
						entitySchemaSlug: "manga",
						properties: { mangaChapter: 2, progressPercent: 100 },
					}),
					eventAutomationContext({
						id: "chapter-2b",
						entitySchemaSlug: "manga",
						properties: { mangaChapter: 2, progressPercent: 100 },
					}),
				),
				host,
			).pipe(
				Effect.map(() => {
					expect(created).toHaveLength(1);
					expect(created[0]?.map((event) => event.occurredAt)).toEqual([
						"2026-01-02T00:00:00+00:00",
						"2026-01-04T00:00:00+00:00",
					]);
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
			properties: { animeEpisode: 101, progressPercent: 100 },
			occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 100)).toISOString(),
		});
		const { host, created, documents } = createHost({
			entityProperties: { episodes: 101 },
			eventPages: [firstPage, [finalEvent]],
		});
		return Effect.runPromise(
			run(
				eventAutomationContext({
					id: finalEvent.id,
					entityId: "entity-1",
					entitySchemaSlug: "anime",
					properties: { animeEpisode: 101, progressPercent: 100 },
				}),
				host,
			).pipe(
				Effect.map(() => {
					expect(created).toHaveLength(1);
					expect(documents.filter((document) => "events" in document.queries)).toMatchObject([
						{ queries: { events: { output: { pagination: {} } } } },
						{ queries: { events: { output: { pagination: { after: "events-1" } } } } },
					]);
					return undefined;
				}),
			),
		);
	});
});
