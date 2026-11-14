import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { randomUuid } from "@ryot-app/testing/random";
import { Clock, Console, Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	createIntegration,
	deleteIntegration,
	getImportRun,
	listEventsForEntity,
	listIntegrationImportRuns,
	markEntityPopulated,
	pollUntil,
} from "~/fixtures/kernel";
import { findMediaEntitySchema, seedMediaEntity } from "~/fixtures/plugins/media";
import { assertCompleted, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

const ITEM_COUNT = 101;
const BUDGET_MS = 900_000;
const RUN_OPERATIONAL_GATES = process.env.RUN_OPERATIONAL_GATES === "1";

describe.skipIf(!RUN_OPERATIONAL_GATES)("Media sync checkpoints at scale", () => {
	it.live(
		"collects multiple windows and leaves unchanged progress unduplicated on the next sync",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schema, pluginId } = yield* findMediaEntitySchema(client, "audiobook");
				const provider = requirePresent(
					schema.providers.find((candidate) => candidate.name === "Audible"),
					"Expected Audible provider",
				);
				const prefix = yield* randomUuid;
				const books = yield* Effect.forEach(
					Array.from({ length: ITEM_COUNT }, (_, index) => index),
					(index) =>
						Effect.gen(function* () {
							const externalId = `${prefix}-${index}`;
							const book = yield* seedMediaEntity({
								externalId,
								userId: null,
								properties: {},
								entitySchemaSlug: schema.id,
								providerId: provider.providerId,
								name: `Checkpoint audiobook ${index}`,
							});
							yield* markEntityPopulated(book.id);
							return { ...book, externalId, sourceId: `book-${index}` };
						}),
				);
				const upstream = yield* startFakeHttpServerScoped((url) => {
					if (url.pathname === "/api/me") {
						return Response.json({ mediaProgress: books.map(() => ({})) });
					}
					if (url.pathname === "/api/me/items-in-progress") {
						return Response.json({
							libraryItems: books.map((book) => ({
								id: book.sourceId,
								media: { metadata: { title: book.name, asin: book.externalId } },
							})),
						});
					}
					if (url.pathname.startsWith("/api/me/progress/")) {
						return Response.json({ progress: 0.42, isFinished: false });
					}
					return new Response(null, { status: 404 });
				});
				const integration = yield* Effect.acquireRelease(
					createIntegration(client, {
						minimumProgress: 2,
						maximumProgress: 95,
						syncOwnership: false,
						provider: { slug: "audiobookshelf", owner: definitionOwner(pluginId) },
						providerSpecifics: {
							baseUrl: upstream.url,
							token: "fixture-token",
							kind: "audiobookshelf",
						},
					}),
					({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
				);
				const completedRuns = new Set<string>();
				const firstEventIds: string[] = [];
				for (let round = 0; round < 2; round++) {
					const startedAt = yield* Clock.currentTimeMillis;
					yield* client.call((c) => c.integrations.sync());
					const runId = yield* pollUntil(
						"Checkpoint sync admitted",
						Effect.gen(function* () {
							const runs = yield* listIntegrationImportRuns(client, integration.id, undefined, 100);
							return runs.items.find((run) => !completedRuns.has(run.id))?.id ?? null;
						}),
					);
					for (;;) {
						expect((yield* Clock.currentTimeMillis) - startedAt).toBeLessThan(BUDGET_MS);
						const run = requirePresent(
							(yield* getImportRun(client, runId, undefined, 20)).run,
							"Expected sync run",
						);
						if (
							run.status === "completed" ||
							run.status === "failed" ||
							run.status === "cancelled"
						) {
							assertCompleted(run, "Checkpoint sync");
							break;
						}
						yield* Effect.sleep("1 second");
					}
					const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;
					completedRuns.add(runId);
					const eventIds: string[] = [];
					for (const book of books) {
						const events = (yield* listEventsForEntity(client, book.id, undefined, 100)).filter(
							(event) => event.eventSchemaSlug === "progress",
						);
						expect(events).toHaveLength(1);
						const event = requirePresent(events[0], "Expected progress event");
						expect(event.properties["progressPercent"]).toBe(42);
						eventIds.push(event.id);
					}
					if (round === 0) {
						firstEventIds.push(...eventIds);
					} else {
						expect(eventIds).toEqual(firstEventIds);
					}
					expect(
						upstream.requests.filter((request) => request.path.startsWith("/api/me/progress/")),
					).toHaveLength(ITEM_COUNT * (round + 1));
					expect(
						upstream.requests.filter((request) => request.path === "/api/me/items-in-progress"),
					).toHaveLength(round + 1);
					yield* Console.log(
						yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
							round,
							elapsedMs,
							items: ITEM_COUNT,
							probe: "media-checkpoint-sync",
						}),
					);
				}
			}),
		2 * BUDGET_MS + 120_000,
	);
});
