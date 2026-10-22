import { EventId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { AutomationInput } from "@ryot-app/plugin-backend-sdk/automation";
import type { CreateEventItem } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { RyotQLDocument } from "@ryot-app/plugin-backend-sdk/ryotql";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { PluginId } from "@ryot-app/plugin-kit/schema";
import { describe, expect, it } from "vitest";

import {
	entityRecord,
	eventAutomationContext,
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
	pluginId: PluginId.make("media-owner"),
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
				return hostSuccess({
					count: items.length,
					outcomes: items.map((_, index) => ({
						index,
						status: "written" as const,
						eventId: EventId.make(`created-event-${index}`),
					})),
				});
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
								eventSchemaSlug: "complete",
								occurredAt: "2026-02-03T04:05:06.000Z",
								properties: { consumedOn: "Jellyfin" },
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
					expect(created[0]).toEqual([
						{
							entityId: "entity-1",
							eventSchemaSlug: "complete",
							properties: { consumedOn: "Plex" },
							occurredAt: "2026-02-03T04:05:06.000Z",
						},
						{
							entityId: "entity-1",
							eventSchemaSlug: "complete",
							occurredAt: "2026-02-04T04:05:06.000Z",
							properties: { consumedOn: "Jellyfin" },
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

	it("completes anime once the cumulative position reaches the episode total", () => {
		const atTotal = createHost({ entityProperties: { episodes: 28 } });
		const beforeTotal = createHost({ entityProperties: { episodes: 28 } });
		return Effect.runPromise(
			Effect.all(
				[
					run(
						eventAutomationContext({
							entityId: "entity-1",
							entitySchemaSlug: "anime",
							properties: { animeEpisode: 28 },
							occurredAt: "2026-03-01T00:00:00.000Z",
						}),
						atTotal.host,
					),
					run(
						eventAutomationContext({
							entityId: "entity-1",
							entitySchemaSlug: "anime",
							properties: { animeEpisode: 12 },
						}),
						beforeTotal.host,
					),
				],
				{ concurrency: "unbounded" },
			).pipe(
				Effect.map(() => {
					expect(atTotal.created).toEqual([
						[
							{
								properties: {},
								entityId: "entity-1",
								eventSchemaSlug: "complete",
								occurredAt: "2026-03-01T00:00:00.000Z",
							},
						],
					]);
					expect(beforeTotal.created).toEqual([]);
					return undefined;
				}),
			),
		);
	});

	it("completes manga on a full percent without a position and ignores unknown totals", () => {
		const fullPercent = createHost({ entityProperties: { chapters: 40 } });
		const unknownTotal = createHost({ entityProperties: {} });
		return Effect.runPromise(
			Effect.all(
				[
					run(
						eventAutomationContext({
							entityId: "entity-1",
							entitySchemaSlug: "manga",
							properties: { progressPercent: 100 },
						}),
						fullPercent.host,
					),
					run(
						eventAutomationContext({
							entityId: "entity-1",
							entitySchemaSlug: "manga",
							properties: { mangaChapter: 99 },
						}),
						unknownTotal.host,
					),
				],
				{ concurrency: "unbounded" },
			).pipe(
				Effect.map(() => {
					expect(fullPercent.created).toHaveLength(1);
					expect(unknownTotal.created).toEqual([]);
					return undefined;
				}),
			),
		);
	});

	it("does not complete again when an equal-or-later completion exists", () => {
		const completion = eventRecord({
			id: "completion-1",
			eventSchemaSlug: "complete",
			occurredAt: "2026-03-01T00:00:00.000Z",
		});
		const repeated = createHost({ events: [completion], entityProperties: { episodes: 28 } });
		const rewatch = createHost({ events: [completion], entityProperties: { episodes: 28 } });
		return Effect.runPromise(
			Effect.all(
				[
					run(
						eventAutomationContext({
							entityId: "entity-1",
							entitySchemaSlug: "anime",
							properties: { animeEpisode: 28 },
							occurredAt: "2026-03-01T00:00:00.000Z",
						}),
						repeated.host,
					),
					run(
						eventAutomationContext({
							entityId: "entity-1",
							entitySchemaSlug: "anime",
							properties: { animeEpisode: 28 },
							occurredAt: "2026-04-01T00:00:00.000Z",
						}),
						rewatch.host,
					),
				],
				{ concurrency: "unbounded" },
			).pipe(
				Effect.map(() => {
					expect(repeated.created).toEqual([]);
					expect(rewatch.created).toHaveLength(1);
					return undefined;
				}),
			),
		);
	});

	it("completes each later cycle once when several positions reach the total in one batch", () => {
		const { host, created } = createHost({ entityProperties: { chapters: 2 } });
		return Effect.runPromise(
			run(
				eventBatch(
					eventAutomationContext({
						id: "first",
						entitySchemaSlug: "manga",
						properties: { mangaChapter: 2 },
						occurredAt: "2026-01-02T00:00:00.000Z",
					}),
					eventAutomationContext({
						id: "second",
						entitySchemaSlug: "manga",
						properties: { mangaChapter: 2 },
						occurredAt: "2026-01-04T00:00:00.000Z",
					}),
				),
				host,
			).pipe(
				Effect.map(() => {
					expect(created).toHaveLength(1);
					expect(created[0]?.map((event) => event.occurredAt)).toEqual([
						"2026-01-02T00:00:00.000Z",
						"2026-01-04T00:00:00.000Z",
					]);
				}),
			),
		);
	});
});
