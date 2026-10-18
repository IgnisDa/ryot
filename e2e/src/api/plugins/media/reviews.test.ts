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
): MediaReviewUpdateInput["expected"] =>
	Schema.decodeUnknownSync(MediaEventSnapshot)({
		entityId,
		properties: event.properties,
		occurredAt: event.occurredAt,
		sessionEntityId: event.sessionEntityId ?? null,
		absentProperties: ["text", "isSpoiler", "rating"].filter((key) => !(key in event.properties)),
	});

describe("Media rating-only reviews", () => {
	it.live("creates, reads, edits and deletes a rating with replay-safe writes", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { entityId } = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const input = { entityId, rating: 0, text: null, isSpoiler: false };
			const idempotencyKey = crypto.randomUUID();
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
			const submissionId = crypto.randomUUID();
			const edit = {
				text: null,
				rating: 100,
				submissionId,
				isSpoiler: false,
				eventId: original.id,
				submittedAt: nowIso(),
				expected: snapshot(entityId, original),
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
					submissionId: crypto.randomUUID(),
				}),
			);
			assertTaggedError(stale, "PluginOperationRejected");
			const deletion = {
				eventId: original.id,
				submittedAt: nowIso(),
				submissionId: crypto.randomUUID(),
			};
			for (let attempt = 0; attempt < 2; attempt++) {
				expect(
					yield* invokeOperation(client, deleteReview, deletion, {
						idempotencyKey: deletion.submissionId,
					}),
				).toEqual({ count: 1 });
			}
			const remaining = yield* listEventsForEntity(client, entityId, undefined, 100);
			expect(remaining.map((event) => event.eventSchemaSlug)).toEqual(["add-to-media-library"]);
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
					properties: { rating: 60, animeEpisode: 3 },
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
						submissionId: crypto.randomUUID(),
						expected: snapshot(entityId, original),
					});
					expect((yield* readReview(client, entityId)).properties).toEqual({
						animeEpisode: 3,
						...(content.text?.trim()
							? { text: content.text.trim(), isSpoiler: content.isSpoiler }
							: {}),
						...(content.rating === null ? {} : { rating: content.rating }),
					});
				}
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
				submissionId: crypto.randomUUID(),
				expected: snapshot(entityId, original),
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
				submissionId: crypto.randomUUID(),
			});
			expect((yield* readReview(client, entityId)).properties).toEqual({ rating: 70 });
			expect(
				yield* listEventsForEntity(client, entityId, undefined, 100, { eventSchemaSlug: "review" }),
			).toHaveLength(1);
		}),
	);
});
