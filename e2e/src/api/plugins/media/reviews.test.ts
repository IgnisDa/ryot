import { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { MediaEventSnapshot } from "@ryot-app/media-plugin/shared/media-activity-operations";
import {
	MediaReviewCreateInput,
	MediaReviewDeleteInput,
	MediaReviewOutput,
	MediaReviewUpdateInput,
} from "@ryot-app/media-plugin/shared/media-review-operations";
import { movieRecipes } from "@ryot-app/media-plugin/shared/movie-recipes";
import { defineOperationRecipe } from "@ryot-app/plugin-kit/operations";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	createEventFixture,
	executeRyotQLRecipe,
	listEventsForEntity,
} from "~/fixtures/kernel";
import { invokeEncodedOperation, invokeOperation } from "~/fixtures/kernel/operations";
import {
	createBuiltinMediaLifecycleFixture,
	logMediaActivity,
	mediaReferenceForEntity,
} from "~/fixtures/plugins/media";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

const createReview = defineOperationRecipe({
	output: MediaReviewOutput,
	input: MediaReviewCreateInput,
	operationSlug: "media-review-create",
	packageId: mediaPlugin.metadata.packageId,
});

const updateReview = defineOperationRecipe({
	output: MediaReviewOutput,
	input: MediaReviewUpdateInput,
	operationSlug: "media-review-update",
	packageId: mediaPlugin.metadata.packageId,
});

const deleteReview = defineOperationRecipe({
	output: MediaReviewOutput,
	input: MediaReviewDeleteInput,
	operationSlug: "media-review-delete",
	packageId: mediaPlugin.metadata.packageId,
});

const readReview = (client: Parameters<typeof listEventsForEntity>[0], entityId: string) =>
	listEventsForEntity(client, entityId, undefined, 100, { eventSchemaSlug: "review" }).pipe(
		Effect.map((events) => requirePresent(events[0], "Expected a review")),
	);

const snapshot = (
	entityId: string,
	event: Effect.Success<ReturnType<typeof readReview>>,
): Effect.Effect<MediaReviewUpdateInput["expected"]> =>
	Schema.decodeUnknownEffect(MediaEventSnapshot)({
		entityId,
		properties: event.properties,
		occurredAt: event.occurredAt,
		sessionEntityId: event.sessionEntityId ?? null,
		absentProperties: ["text", "isSpoiler", "rating"].filter((key) => !(key in event.properties)),
	}).pipe(Effect.orDie);

const occurrenceOf = (
	client: Parameters<typeof listEventsForEntity>[0],
	entityId: string,
	eventSchemaSlug: string,
) =>
	listEventsForEntity(client, entityId, undefined, 100, { eventSchemaSlug }).pipe(
		Effect.map((events) => requirePresent(events[0], `Expected a ${eventSchemaSlug} event`)),
	);

describe("Media review occurrence links", () => {
	it.live("links, keeps, relinks and clears what a review is about", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId, backlogEventSchemaSlug, progressEventSchemaSlug } =
				yield* createBuiltinMediaLifecycleFixture(client, { entitySchemaSlug: "movie" });
			const other = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			yield* logMediaActivity(client, {
				submittedAt: nowIso(),
				submissionId: yield* randomUuid,
				entry: { entityId, kind: "complete", when: { kind: "now" } },
			});
			yield* logMediaActivity(client, {
				submittedAt: nowIso(),
				submissionId: yield* randomUuid,
				entry: { kind: "complete", when: { kind: "now" }, entityId: other.entityId },
			});
			yield* createEventFixture(client, {
				entityId,
				properties: { progressPercent: 40 },
				eventSchemaSlug: progressEventSchemaSlug,
			});
			yield* createEventFixture(client, {
				entityId,
				properties: {},
				eventSchemaSlug: backlogEventSchemaSlug,
			});
			const completion = yield* occurrenceOf(client, entityId, "complete");
			const progress = yield* occurrenceOf(client, entityId, "progress");
			const backlog = yield* occurrenceOf(client, entityId, "backlog");
			const foreign = yield* occurrenceOf(client, other.entityId, "complete");
			const content = { rating: 80, text: null, isSpoiler: false };
			yield* invokeOperation(client, createReview, {
				...content,
				entityId,
				consumptionEventId: completion.id,
			});
			expect((yield* readReview(client, entityId)).properties).toEqual({
				rating: 80,
				consumptionEventId: completion.id,
			});
			const update = (consumptionEventId?: null | string) =>
				Effect.gen(function* () {
					const original = yield* readReview(client, entityId);
					return yield* invokeOperation(client, updateReview, {
						...content,
						eventId: original.id,
						submittedAt: nowIso(),
						submissionId: yield* randomUuid,
						expected: yield* snapshot(entityId, original),
						...(consumptionEventId === undefined ? {} : { consumptionEventId }),
					});
				});
			yield* update();
			expect((yield* readReview(client, entityId)).properties["consumptionEventId"]).toBe(
				completion.id,
			);
			yield* update(progress.id);
			expect((yield* readReview(client, entityId)).properties["consumptionEventId"]).toBe(
				progress.id,
			);
			yield* update(null);
			expect((yield* readReview(client, entityId)).properties).toEqual({ rating: 80 });
			for (const rejected of [foreign.id, backlog.id, "event-that-does-not-exist"]) {
				assertTaggedError(yield* Effect.flip(update(rejected)), "PluginOperationRejected");
				assertTaggedError(
					yield* Effect.flip(
						invokeOperation(client, createReview, {
							...content,
							entityId,
							consumptionEventId: rejected,
						}),
					),
					"PluginOperationRejected",
				);
			}
			expect((yield* readReview(client, entityId)).properties).toEqual({ rating: 80 });
		}),
	);

	it.live("clears the link when its occurrence is deleted or a fold removes it", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const explicit = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			yield* logMediaActivity(client, {
				submittedAt: nowIso(),
				submissionId: yield* randomUuid,
				entry: { kind: "complete", when: { kind: "now" }, entityId: explicit.entityId },
			});
			const completion = yield* occurrenceOf(client, explicit.entityId, "complete");
			const content = { rating: 60, text: null, isSpoiler: false };
			yield* invokeOperation(client, createReview, {
				...content,
				entityId: explicit.entityId,
				consumptionEventId: completion.id,
			});
			yield* client.call((c) => c.events.delete({ params: { eventId: completion.id } }));
			expect((yield* readReview(client, explicit.entityId)).properties).toEqual({ rating: 60 });

			const automatic = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			yield* createEventFixture(client, {
				entityId: automatic.entityId,
				properties: { progressPercent: 100 },
				eventSchemaSlug: automatic.progressEventSchemaSlug,
			});
			const derived = yield* occurrenceOf(client, automatic.entityId, "complete");
			expect(derived.properties["completionKey"]).toBeDefined();
			yield* invokeOperation(client, createReview, {
				...content,
				entityId: automatic.entityId,
				consumptionEventId: derived.id,
			});
			const progress = yield* occurrenceOf(client, automatic.entityId, "progress");
			yield* client.call((c) => c.events.delete({ params: { eventId: progress.id } }));
			expect(
				yield* listEventsForEntity(client, automatic.entityId, undefined, 100, {
					eventSchemaSlug: "complete",
				}),
			).toEqual([]);
			expect((yield* readReview(client, automatic.entityId)).properties).toEqual({ rating: 60 });
		}),
	);
});

describe("Media rating-only reviews", () => {
	it.live("creates, reads, edits and deletes a rating with replay-safe writes", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId } = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const input = { entityId, rating: 0, text: null, isSpoiler: false };
			const idempotencyKey = yield* randomUuid;
			expect(
				yield* Effect.all(
					[
						invokeOperation(client, createReview, input, { idempotencyKey }),
						invokeOperation(client, createReview, input, { idempotencyKey }),
					],
					{ concurrency: "unbounded" },
				),
			).toEqual([{ count: 1 }, { count: 1 }]);
			const reference = yield* mediaReferenceForEntity(client, entityId);
			const activity = yield* executeRyotQLRecipe(
				client,
				movieRecipes.activityRecipe({
					entityId,
					reference,
					eventLimit: 60,
					collectionEventLimit: 60,
				}),
			);
			expect(
				activity.events.filter(
					(event) => event.kind === "media" && event.eventSchemaSlug === "review",
				),
			).toMatchObject([{ rating: 0, text: null, isSpoiler: null }]);
			const original = yield* readReview(client, entityId);
			expect(original.properties).toEqual({ rating: 0 });
			const submissionId = yield* randomUuid;
			const edit = {
				text: null,
				rating: 100,
				submissionId,
				isSpoiler: false,
				eventId: original.id,
				submittedAt: nowIso(),
				expected: yield* snapshot(entityId, original),
			};
			for (let attempt = 0; attempt < 2; attempt++) {
				expect(
					yield* invokeOperation(client, updateReview, edit, { idempotencyKey: submissionId }),
				).toEqual({ count: 1 });
			}
			expect((yield* readReview(client, entityId)).properties).toEqual({ rating: 100 });
			const stale = yield* Effect.flip(
				invokeOperation(client, updateReview, {
					...edit,
					rating: 50,
					submissionId: yield* randomUuid,
				}),
			);
			assertTaggedError(stale, "PluginOperationRejected");
			const deletion = {
				eventId: original.id,
				submittedAt: nowIso(),
				submissionId: yield* randomUuid,
			};
			for (let attempt = 0; attempt < 2; attempt++) {
				expect(
					yield* invokeOperation(client, deleteReview, deletion, {
						idempotencyKey: deletion.submissionId,
					}),
				).toEqual({ count: 1 });
			}
			const remaining = yield* listEventsForEntity(client, entityId, undefined, 100);
			expect(remaining.map((event) => event.eventSchemaSlug)).toEqual([
				EventSchemaSlug.make("add-to-media-library"),
			]);
		}),
	);

	it.live(
		"edits imported rating-only records and clears content without losing positional metadata",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { entityId, reviewEventSchemaSlug } = yield* createBuiltinMediaLifecycleFixture(
					client,
					{ entitySchemaSlug: "anime" },
				);
				yield* createEventFixture(client, {
					entityId,
					eventSchemaSlug: reviewEventSchemaSlug,
					properties: { rating: 60, position: { position: 3, unit: "episodes" } },
				});
				for (const content of [
					{ text: null, rating: 82.5, isSpoiler: false },
					{ rating: 82.5, isSpoiler: true, text: "  Good ending  " },
					{ rating: null, isSpoiler: false, text: "Good ending" },
					{ rating: 0, text: "  ", isSpoiler: true },
				]) {
					const original = yield* readReview(client, entityId);
					yield* invokeEncodedOperation(client, updateReview, {
						...content,
						eventId: original.id,
						submittedAt: nowIso(),
						submissionId: yield* randomUuid,
						expected: yield* snapshot(entityId, original),
					});
					expect((yield* readReview(client, entityId)).properties).toEqual({
						position: { position: 3, unit: "episodes" },
						...(content.text?.trim()
							? { text: content.text.trim(), isSpoiler: content.isSpoiler }
							: {}),
						...(content.rating === null ? {} : { rating: content.rating }),
					});
				}
			}),
	);

	it.live("creates, edits and clears positional reviews for anime and manga only", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const anime = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "anime",
			});
			const manga = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "manga",
			});
			const movie = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const content = { rating: 70, text: null, isSpoiler: false };
			yield* invokeOperation(client, createReview, {
				...content,
				entityId: anime.entityId,
				position: { position: 5, unit: "episodes" },
			});
			yield* invokeOperation(client, createReview, {
				...content,
				entityId: manga.entityId,
				position: { volume: 3, position: 12.5, unit: "chapters" },
			});
			expect((yield* readReview(client, anime.entityId)).properties).toEqual({
				rating: 70,
				position: { position: 5, unit: "episodes" },
			});
			expect((yield* readReview(client, manga.entityId)).properties).toEqual({
				rating: 70,
				position: { volume: 3, position: 12.5, unit: "chapters" },
			});
			const update = (
				entityId: string,
				original: Effect.Success<ReturnType<typeof readReview>>,
				position: MediaReviewUpdateInput["position"],
			) =>
				Effect.gen(function* () {
					return yield* invokeOperation(client, updateReview, {
						...content,
						eventId: original.id,
						submittedAt: nowIso(),
						submissionId: yield* randomUuid,
						expected: yield* snapshot(entityId, original),
						...(position === undefined ? {} : { position }),
					});
				});
			const original = yield* readReview(client, manga.entityId);
			yield* update(manga.entityId, original, { position: 4, unit: "volumes" });
			expect((yield* readReview(client, manga.entityId)).properties).toEqual({
				rating: 70,
				position: { position: 4, unit: "volumes" },
			});
			yield* update(manga.entityId, yield* readReview(client, manga.entityId), undefined);
			expect((yield* readReview(client, manga.entityId)).properties.position).toEqual({
				position: 4,
				unit: "volumes",
			});
			yield* update(manga.entityId, yield* readReview(client, manga.entityId), null);
			expect((yield* readReview(client, manga.entityId)).properties).toEqual({ rating: 70 });
			for (const rejected of [
				{ entityId: movie.entityId, position: { position: 1, unit: "episodes" as const } },
				{ entityId: anime.entityId, position: { position: 1, unit: "chapters" as const } },
				{ entityId: anime.entityId, position: { position: 1.5, unit: "episodes" as const } },
				{
					entityId: manga.entityId,
					position: { volume: 2, position: 1, unit: "volumes" as const },
				},
			]) {
				const failure = yield* Effect.flip(
					invokeOperation(client, createReview, { ...content, ...rejected }),
				);
				assertTaggedError(failure, "PluginOperationRejected");
			}
			const movieReview = yield* Effect.flip(
				invokeOperation(client, createReview, {
					...content,
					position: null,
					entityId: movie.entityId,
				}),
			);
			assertTaggedError(movieReview, "PluginOperationRejected");
		}),
	);

	it.live("rejects empty or invalid content and other users' edits and deletes", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { client: other } = yield* createAuthenticatedClient();
			const { entityId } = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			yield* invokeOperation(client, createReview, {
				entityId,
				rating: 70,
				text: null,
				isSpoiler: false,
			});
			const original = yield* readReview(client, entityId);
			for (const content of [
				{ text: "   ", rating: null },
				{ text: null, rating: -1 },
				{ rating: 101, text: "Valid text" },
			]) {
				const failure = yield* Effect.flip(
					invokeEncodedOperation(client, createReview, { ...content, entityId, isSpoiler: false }),
				);
				assertTaggedError(failure, "PluginInvocationError");
			}
			const edit = {
				text: null,
				rating: 80,
				isSpoiler: false,
				eventId: original.id,
				submittedAt: nowIso(),
				submissionId: yield* randomUuid,
				expected: yield* snapshot(entityId, original),
			};
			const emptyEdit = yield* Effect.flip(
				invokeEncodedOperation(client, updateReview, { ...edit, text: "   ", rating: null }),
			);
			assertTaggedError(emptyEdit, "PluginInvocationError");
			const foreignEdit = yield* Effect.flip(invokeOperation(other, updateReview, edit));
			assertTaggedError(foreignEdit, "PluginOperationRejected");
			yield* invokeOperation(other, deleteReview, {
				eventId: original.id,
				submittedAt: nowIso(),
				submissionId: yield* randomUuid,
			});
			expect((yield* readReview(client, entityId)).properties).toEqual({ rating: 70 });
			expect(
				yield* listEventsForEntity(client, entityId, undefined, 100, { eventSchemaSlug: "review" }),
			).toHaveLength(1);
		}),
	);
});
