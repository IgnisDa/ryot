import { assert, describe, expect, it } from "@effect/vitest";
import type { ManagedAssetLocator } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { Deferred, Fiber } from "effect";

import {
	decodeWorkoutEditorDraft,
	encodeWorkoutEditorDraft,
} from "../../shared/workout-editor-draft";
import { WorkoutEditorSaveInputSchema } from "../../shared/workout-editor-operations";
import { controllerHarness } from "../../tests/client/controller-harness";
import { exerciseOccurrence, liveDraft } from "../../tests/client/draft-fixtures";
import { removeDraftMedia } from "./media-state";

const asset: ManagedAssetLocator = { type: "local", key: "permanent/new-image.jpg" };
const existing: ManagedAssetLocator = { type: "s3", key: "permanent/saved.jpg" };
const now = "2026-10-16T10:00:00.000Z";
const initial = () =>
	liveDraft({
		startedAt: now,
		name: "Workout",
		images: [existing],
		occurrences: [{ ...exerciseOccurrence("reps"), sets: [] }],
	});
const fixture = (options: Parameters<typeof controllerHarness>[0] = {}) =>
	controllerHarness({
		upload: () => Effect.succeed(asset),
		now: Effect.succeed(Date.parse(now)),
		...options,
	});

describe("workout media lifecycle", () => {
	it.effect("persists completed uploads and recovers them without signed URLs or bytes", () =>
		Effect.gen(function* () {
			const state = fixture();
			yield* state.controller.load();
			yield* state.controller.start(initial());
			yield* state.controller.uploadMedia(
				{ kind: "occurrence", occurrenceId: "occurrence-1" },
				"images",
				new File(["image"], "image.jpg", { type: "image/jpeg" }),
			);
			const decoded = decodeWorkoutEditorDraft(state.read());
			assert(decoded._tag === "Success");
			expect(decoded.success.occurrences[0]?.images).toEqual([asset]);
			expect(decoded.success.uploadedAssets).toEqual([asset]);
			const recovered = fixture({ stored: state.read() });
			yield* recovered.controller.load();
			const snapshot = recovered.controller.getSnapshot();
			assert(snapshot.status === "ready");
			expect(snapshot.draft.occurrences[0]?.images).toEqual([asset]);
			expect(recovered.cleaned).toEqual([]);
		}),
	);
	it.effect(
		"cancel cleans only new uploads and never loaded references, even after draft removal",
		() =>
			Effect.gen(function* () {
				const state = fixture();
				yield* state.controller.load();
				yield* state.controller.start(initial());
				state.controller.change((draft) =>
					removeDraftMedia(draft, { kind: "workout" }, "images", existing),
				);
				yield* state.controller.uploadMedia(
					{ kind: "occurrence", occurrenceId: "occurrence-1" },
					"images",
					new File(["image"], "image.jpg"),
				);
				expect(yield* state.controller.discard()).toBe(true);
				expect(state.cleaned).toEqual([asset]);
				expect(state.read()).toBeNull();
			}),
	);
	it.effect("cleanup failure does not fail discard", () =>
		Effect.gen(function* () {
			const state = fixture({
				cleanupFails: true,
				stored: encodeWorkoutEditorDraft({ ...initial(), uploadedAssets: [asset] }),
			});
			yield* state.controller.load();
			expect(yield* state.controller.discard()).toBe(true);
			expect(state.controller.getSnapshot().status).toBe("empty");
		}),
	);
	it.effect("does not clean a removed upload until the removal is persisted", () =>
		Effect.gen(function* () {
			let fail = false;
			const state = fixture({ onWrite: () => (fail ? Effect.fail("quota") : Effect.void) });
			yield* state.controller.load();
			yield* state.controller.start(initial());
			yield* state.controller.uploadMedia(
				{ kind: "occurrence", occurrenceId: "occurrence-1" },
				"images",
				new File(["image"], "image.jpg"),
			);
			fail = true;
			state.controller.change((draft) =>
				removeDraftMedia(
					draft,
					{ kind: "occurrence", occurrenceId: "occurrence-1" },
					"images",
					asset,
				),
			);
			yield* state.controller.flush().pipe(Effect.ignore);
			expect(state.cleaned).toEqual([]);
			fail = false;
			yield* state.controller.flush();
			expect(state.cleaned).toEqual([asset]);
			const decoded = decodeWorkoutEditorDraft(state.read());
			assert(decoded._tag === "Success");
			expect(decoded.success.uploadedAssets).toEqual([]);
		}),
	);
	it.effect("keeps work in memory when upload persistence fails", () =>
		Effect.gen(function* () {
			let fail = false;
			const state = fixture({ onWrite: () => (fail ? Effect.fail("quota") : Effect.void) });
			yield* state.controller.load();
			yield* state.controller.start(initial());
			fail = true;
			yield* state.controller
				.uploadMedia(
					{ kind: "occurrence", occurrenceId: "occurrence-1" },
					"images",
					new File(["image"], "image.jpg"),
				)
				.pipe(Effect.ignore);
			const snapshot = state.controller.getSnapshot();
			assert(snapshot.status === "ready");
			expect(snapshot.draft.occurrences[0]?.images).toEqual([asset]);
			expect(snapshot.persistenceError).toBeDefined();
			expect(snapshot.uploading).toBe(false);
			expect(state.cleaned).toEqual([]);
		}),
	);
	it.effect(
		"blocks saving and discarding during upload and cleans a late result for a deleted occurrence",
		() =>
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				const result = yield* Deferred.make<ManagedAssetLocator>();
				const state = fixture({
					upload: () =>
						Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(result))),
				});
				yield* state.controller.load();
				yield* state.controller.start(initial());
				const uploading = yield* Effect.forkChild(
					state.controller.uploadMedia(
						{ kind: "occurrence", occurrenceId: "occurrence-1" },
						"images",
						new File(["image"], "image.jpg"),
					),
				);
				yield* Deferred.await(started);
				expect(yield* state.controller.discard()).toBe(false);
				const submission = yield* Schema.decodeEffect(WorkoutEditorSaveInputSchema)({
					submittedAt: now,
					submissionId: "save-1",
					data: {
						images: [],
						videos: [],
						supersets: [],
						startedAt: now,
						name: "Workout",
						kind: "workout",
						occurrences: [],
						target: { kind: "create" },
						activeDuration: { seconds: 0, kind: "set" },
					},
				});
				const rejected = yield* state.controller.beginSubmission(submission).pipe(Effect.result);
				expect(rejected._tag).toBe("Failure");
				state.controller.change((draft) => ({ ...draft, occurrences: [] }));
				yield* Deferred.succeed(result, asset);
				yield* Fiber.join(uploading);
				expect(state.cleaned).toEqual([asset]);
			}),
	);
	it.effect("preserves recovered frozen submissions without attempting cleanup", () =>
		Effect.gen(function* () {
			const submission = yield* Schema.decodeEffect(WorkoutEditorSaveInputSchema)({
				submittedAt: now,
				submissionId: "save-1",
				data: {
					videos: [],
					supersets: [],
					startedAt: now,
					name: "Workout",
					kind: "workout",
					images: [asset],
					occurrences: [],
					target: { kind: "create" },
					activeDuration: { seconds: 0, kind: "set" },
				},
			});
			const state = fixture({
				stored: encodeWorkoutEditorDraft({ ...initial(), submission, uploadedAssets: [asset] }),
			});
			yield* state.controller.load();
			yield* state.controller.flush();
			expect(state.cleaned).toEqual([]);
			expect(yield* state.controller.discard()).toBe(false);
		}),
	);
	it.effect("permits free exercise uploads but rejects protected workout uploads", () =>
		Effect.gen(function* () {
			const state = fixture({ pro: false });
			yield* state.controller.load();
			yield* state.controller.start(initial());
			const protectedUpload = yield* state.controller
				.uploadMedia({ kind: "workout" }, "images", new File(["image"], "image.jpg"))
				.pipe(Effect.result);
			expect(protectedUpload._tag).toBe("Failure");
			yield* state.controller.uploadMedia(
				{ kind: "occurrence", occurrenceId: "occurrence-1" },
				"images",
				new File(["image"], "image.jpg"),
			);
			const snapshot = state.controller.getSnapshot();
			assert(snapshot.status === "ready");
			expect(snapshot.draft.occurrences[0]?.images).toEqual([asset]);
		}),
	);
});
