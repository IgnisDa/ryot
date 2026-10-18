import { describe, expect, it, layer } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	PluginId,
	PluginPackageId,
	type PluginDeviceRequest,
} from "@ryot-app/plugin-client-sdk/plugin";
import { RyotScheduleService } from "@ryot-app/plugin-client-sdk/schedule";
import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { Layer } from "effect";
import * as Deferred from "effect/Deferred";
import { TestClock } from "effect/testing";

import { decodeWorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { WorkoutEditorSaveInputSchema } from "../../shared/workout-editor-operations";
import { controllerHarness } from "../../tests/client/controller-harness";
import { exerciseOccurrence, liveDraft, startTime } from "../../tests/client/draft-fixtures";

const draft = (name = "Session") => liveDraft({ name });

const saveInput = (submissionId = "submission-1") =>
	Schema.decodeSync(WorkoutEditorSaveInputSchema)({
		submissionId,
		submittedAt: startTime,
		data: {
			images: [],
			videos: [],
			supersets: [],
			name: "Session",
			kind: "workout",
			occurrences: [],
			startedAt: startTime,
			target: { kind: "create" },
			activeDuration: { seconds: 0, kind: "set" },
		},
	});

const timerDraft = () =>
	liveDraft({
		name: "Session",
		occurrences: [exerciseOccurrence("duration", { duration: "20" })],
		executionCountdown: {
			setId: "set-1",
			durationSeconds: 20,
			clientId: "execution-1",
			occurrenceId: "occurrence-1",
			deadline: "2026-10-15T10:00:20.000Z",
			exerciseId: EntityId.make("exercise-1"),
		},
	});

const createController = controllerHarness;

describe("workout editor controller", () => {
	it.live("reads a valid draft once and keeps unreadable storage behind explicit recovery", () =>
		Effect.gen(function* () {
			const valid = createController();
			yield* valid.controller.load();
			yield* valid.controller.load();
			expect(valid.reads).toBe(1);
			expect(valid.controller.getSnapshot().status).toBe("empty");

			const unreadable = createController({ onRead: () => "not-a-draft" });
			yield* unreadable.controller.load();
			expect(unreadable.controller.getSnapshot().status).toBe("recovery-error");
			expect(yield* unreadable.controller.start(draft())).toBe(false);
			expect(unreadable.writes).toHaveLength(0);
			expect(yield* unreadable.controller.discard()).toBe(true);
			expect(unreadable.removals).toBe(1);
			expect(unreadable.controller.getSnapshot().status).toBe("empty");
		}),
	);

	it.live("keeps memory changes immediately and retries persistence after a failure", () =>
		Effect.gen(function* () {
			let shouldFail = true;
			const harness = createController({
				onWrite: () => (shouldFail ? Effect.fail("quota") : Effect.void),
			});
			yield* harness.controller.load();
			const start = yield* Effect.exit(harness.controller.start(draft()));
			expect(start._tag).toBe("Failure");
			const first = harness.controller.getSnapshot();
			expect(first.status).toBe("ready");
			if (first.status === "ready") {
				expect(first.draft.name).toBe("Session");
				expect(first.dirty).toBe(true);
				expect(first.persistenceError).toBe("quota");
			}
			shouldFail = false;
			expect(harness.controller.change((current) => ({ ...current, name: "Updated" }))).toBe(true);
			const immediate = harness.controller.getSnapshot();
			expect(immediate.status === "ready" && immediate.draft.name).toBe("Updated");
			yield* harness.controller.flush();
			const saved = decodeWorkoutEditorDraft(harness.stored);
			expect(saved._tag).toBe("Success");
			if (saved._tag === "Success") {
				expect(saved.success.name).toBe("Updated");
			}
		}),
	);

	it.live("serializes writes so an older in-flight snapshot cannot become the final value", () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const completed = yield* Deferred.make<void>();
			let shouldBlock = false;
			const harness = createController({
				onWrite: () =>
					Effect.gen(function* () {
						if (shouldBlock) {
							shouldBlock = false;
							yield* Deferred.succeed(started, undefined);
							yield* Deferred.await(release);
						}
					}),
			});
			yield* harness.controller.load();
			yield* harness.controller.start(draft());
			harness.controller.change((current) => ({ ...current, name: "Older" }));
			shouldBlock = true;
			yield* Effect.forkChild(
				harness.controller.flush().pipe(Effect.tap(() => Deferred.succeed(completed, undefined))),
			);
			yield* Deferred.await(started);
			harness.controller.change((current) => ({ ...current, name: "Newest" }));
			yield* Deferred.succeed(release, undefined);
			yield* Deferred.await(completed);
			const saved = decodeWorkoutEditorDraft(harness.stored);
			expect(saved._tag).toBe("Success");
			if (saved._tag === "Success") {
				expect(saved.success.name).toBe("Newest");
			}
			expect(harness.writes).toHaveLength(3);
		}),
	);

	it.live("persists a frozen submission before execution and blocks discard while saving", () =>
		Effect.gen(function* () {
			const harness = createController();
			yield* harness.controller.load();
			yield* harness.controller.start(draft());
			const submitted = saveInput();
			expect(yield* harness.controller.beginSubmission(submitted)).toEqual(submitted);
			const storedDraft = decodeWorkoutEditorDraft(harness.stored);
			expect(storedDraft._tag).toBe("Success");
			if (storedDraft._tag === "Success") {
				expect(storedDraft.success.submission).toEqual(submitted);
			}
			expect(yield* harness.controller.beginSubmission(saveInput("other"))).toEqual(submitted);
			harness.controller.setSaving(true);
			expect(yield* harness.controller.discard()).toBe(false);
			expect(harness.removals).toBe(0);
			harness.controller.setSaving(false);
			expect(
				harness.controller.change((current) => ({ ...current, name: "Must stay frozen" })),
			).toBe(false);
			expect(yield* harness.controller.discard()).toBe(false);
			expect(yield* harness.controller.finish()).toBe(true);
			expect(harness.stored).toBeNull();
			expect(harness.controller.getSnapshot().status).toBe("empty");
		}),
	);

	it.live("unlocks only a definitely unwritten rejected submission", () =>
		Effect.gen(function* () {
			const harness = createController();
			yield* harness.controller.load();
			yield* harness.controller.start(draft());
			yield* harness.controller.beginSubmission(saveInput());
			harness.controller.setSaving(true);
			harness.controller.setSaving(false);
			expect(harness.controller.change((current) => ({ ...current, name: "Unsafe edit" }))).toBe(
				false,
			);
			expect(
				yield* harness.controller.rejectSubmission({
					kind: "invalid",
					code: "missing-measurement",
				}),
			).toBe(true);
			expect(
				harness.controller.change((current) => ({ ...current, name: "Corrected input" })),
			).toBe(true);
			yield* harness.controller.flush();
			const recovered = decodeWorkoutEditorDraft(harness.stored);
			expect(recovered._tag).toBe("Success");
			if (recovered._tag === "Success") {
				expect(recovered.success.submission).toBeUndefined();
				expect(recovered.success.name).toBe("Corrected input");
			}
		}),
	);

	it.live("unlocks a retry once its atomic rejection is known", () =>
		Effect.gen(function* () {
			const harness = createController();
			yield* harness.controller.load();
			yield* harness.controller.start(draft());
			yield* harness.controller.beginSubmission(saveInput());
			harness.controller.setSaving(true);
			harness.controller.setSaving(false);
			yield* harness.controller.beginSubmission(saveInput());
			harness.controller.setSaving(true);
			harness.controller.setSaving(false);
			expect(yield* harness.controller.rejectSubmission({ kind: "pro-required" })).toBe(true);
			expect(
				harness.controller.change((current) => ({ ...current, name: "Corrected retry" })),
			).toBe(true);
		}),
	);

	it.live(
		"persists timer changes before scheduling stable per-draft alerts and cancels after recovery",
		() =>
			Effect.gen(function* () {
				const events: string[] = [];
				const requests: PluginDeviceRequest[] = [];
				const pluginId = PluginId.make("fitness-installation");
				const target = {
					search: "",
					path: "/workout",
					kind: "plugin-route" as const,
					packageId: PluginPackageId.make("ryot/fitness"),
				};
				const harness = createController({
					events,
					target,
					pluginId,
					device: (request) =>
						Effect.sync(() => {
							requests.push(request);
							events.push(request.action);
							return { status: request.action === "schedule" ? "scheduled" : "done" };
						}),
				});
				yield* harness.controller.load();
				events.length = 0;
				requests.length = 0;
				yield* harness.controller.start(timerDraft());
				expect(events[0]).toBe("write");
				const executionKey = "fitness-workout-editor:draft-1:execution";
				expect(requests).toContainEqual(
					expect.objectContaining({ key: executionKey, action: "schedule" }),
				);

				harness.controller.change((current) => ({
					...current,
					executionCountdown: current.executionCountdown
						? {
								...current.executionCountdown,
								clientId: "execution-2",
								deadline: "2026-10-15T10:00:30.000Z",
							}
						: undefined,
				}));
				yield* harness.controller.flush();
				expect(
					requests.filter(
						(request) => request.action === "schedule" && request.key === executionKey,
					),
				).toHaveLength(2);

				harness.controller.change((current) => ({ ...current, executionCountdown: undefined }));
				yield* harness.controller.flush();
				expect(requests).toContainEqual(
					expect.objectContaining({ action: "cancel", key: executionKey }),
				);
				const recovered = createController({
					target,
					pluginId,
					onRead: () => harness.stored,
					device: (request) =>
						Effect.sync(() => {
							requests.push(request);
							return { status: request.action === "schedule" ? "scheduled" : "done" };
						}),
				});
				yield* recovered.controller.load();
				expect(requests).toContainEqual(
					expect.objectContaining({ action: "cancel", key: executionKey }),
				);
			}),
	);

	layer(RyotScheduleService.layer.pipe(Layer.provideMerge(TestClock.layer())))((test) => {
		test.effect(
			"pulses once per second in the final three seconds and cancels them when paused",
			() =>
				Effect.gen(function* () {
					yield* TestClock.setTime(Date.parse(startTime));
					const schedule = yield* RyotScheduleService;
					const requests: PluginDeviceRequest[] = [];
					const harness = createController({
						schedule,
						now: Effect.sync(() => schedule.now()),
						pluginId: PluginId.make("fitness-installation"),
						device: (request) =>
							Effect.sync(() => {
								requests.push(request);
								return { status: "done" };
							}),
					});
					yield* harness.controller.load();
					yield* harness.controller.start(timerDraft());

					yield* TestClock.adjust("17 seconds");
					expect(requests.filter((request) => request.action === "haptic")).toHaveLength(1);
					yield* TestClock.adjust("1 second");
					expect(requests.filter((request) => request.action === "haptic")).toHaveLength(2);
					yield* TestClock.adjust("1 second");
					expect(requests.filter((request) => request.action === "haptic")).toHaveLength(3);

					harness.controller.change((current) => ({
						...current,
						executionCountdown: current.executionCountdown
							? {
									...current.executionCountdown,
									clientId: "execution-2",
									deadline: "2026-10-15T10:00:40.000Z",
								}
							: undefined,
					}));
					yield* harness.controller.flush();
					harness.controller.change((current) => ({
						...current,
						executionCountdown: current.executionCountdown
							? { ...current.executionCountdown, pausedRemainingSeconds: 21 }
							: undefined,
					}));
					yield* harness.controller.flush();
					yield* TestClock.adjust("30 seconds");
					expect(requests.filter((request) => request.action === "haptic")).toHaveLength(3);
					const paused = harness.controller.getSnapshot();
					expect(
						paused.status === "ready" && paused.draft.executionCountdown?.pausedRemainingSeconds,
					).toBe(21);
				}),
		);

		test.effect("does not schedule missed pulses or pulse while in the background", () =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse(startTime) + 18_500);
				const schedule = yield* RyotScheduleService;
				let foreground = false;
				const requests: PluginDeviceRequest[] = [];
				const harness = createController({
					schedule,
					foreground: () => foreground,
					now: Effect.sync(() => schedule.now()),
					pluginId: PluginId.make("fitness-installation"),
					device: (request) =>
						Effect.sync(() => {
							requests.push(request);
							return { status: "done" };
						}),
				});
				yield* harness.controller.load();
				yield* harness.controller.start(timerDraft());
				expect(requests.filter((request) => request.action === "haptic")).toHaveLength(0);

				yield* TestClock.adjust("500 millis");
				expect(requests.filter((request) => request.action === "haptic")).toHaveLength(0);
				foreground = true;
				yield* TestClock.adjust("1 second");
				expect(requests.filter((request) => request.action === "haptic")).toHaveLength(0);
			}),
		);

		test.effect("skips a warning callback that is more than 500 milliseconds late", () =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse(startTime) + 17_500);
				const schedule = yield* RyotScheduleService;
				let observedOffset = 0;
				const requests: PluginDeviceRequest[] = [];
				const harness = createController({
					schedule,
					pluginId: PluginId.make("fitness-installation"),
					now: Effect.sync(() => schedule.now() + observedOffset),
					device: (request) =>
						Effect.sync(() => {
							requests.push(request);
							return { status: "done" };
						}),
				});
				yield* harness.controller.load();
				yield* harness.controller.start(timerDraft());

				observedOffset = 501;
				yield* TestClock.adjust("1500 millis");
				expect(requests.filter((request) => request.action === "haptic")).toHaveLength(0);
			}),
		);
	});

	it.live("keeps background alerts scheduled and reconciles their deadlines once on return", () =>
		Effect.gen(function* () {
			let now = Date.parse(startTime);
			let foreground = true;
			const requests: PluginDeviceRequest[] = [];
			const harness = createController({
				now: Effect.sync(() => now),
				foreground: () => foreground,
				pluginId: PluginId.make("fitness-installation"),
				target: {
					search: "",
					path: "/workout",
					kind: "plugin-route",
					packageId: PluginPackageId.make("ryot/fitness"),
				},
				device: (request) =>
					Effect.sync(() => {
						requests.push(request);
						return { status: request.action === "schedule" ? "inexact" : "done" };
					}),
			});
			yield* harness.controller.load();
			yield* harness.controller.start(timerDraft());
			const running = harness.controller.getSnapshot();
			expect(running.status === "ready" && running.alertStatus.execution).toBe("inexact");
			harness.controller.change((current) => ({
				...current,
				localPreferences: { muteSounds: true },
			}));
			yield* harness.controller.flush();
			expect(
				requests
					.filter((request) => request.action === "schedule")
					.map((request) => request.audible),
			).toEqual([true, false]);
			now += 60_000;
			foreground = false;
			const backgroundWrites = harness.writes.length;
			const backgroundRequests = requests.length;
			yield* harness.controller.reconcile();
			expect(harness.writes).toHaveLength(backgroundWrites);
			expect(requests).toHaveLength(backgroundRequests);
			foreground = true;
			yield* harness.controller.reconcile();
			const completed = decodeWorkoutEditorDraft(harness.stored);
			expect(completed._tag).toBe("Success");
			if (completed._tag === "Success") {
				expect(completed.success.occurrences[0]?.sets[0]?.confirmedAt).toBe(
					"2026-10-15T10:00:20.000Z",
				);
				expect(completed.success.restCountdown).toBeUndefined();
			}
			const writes = harness.writes.length;
			yield* harness.controller.reconcile();
			expect(harness.writes).toHaveLength(writes);
		}),
	);
});
