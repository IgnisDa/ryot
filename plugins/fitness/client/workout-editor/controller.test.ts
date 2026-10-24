import { describe, expect, it, layer } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	type PluginDeviceRequest,
	PluginId,
	PluginPackageId,
} from "@ryot-app/plugin-client-sdk/plugin";
import { RyotScheduleService } from "@ryot-app/plugin-client-sdk/schedule";
import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { Fiber, Layer } from "effect";
import * as Deferred from "effect/Deferred";
import { TestClock } from "effect/testing";

import {
	decodeWorkoutEditorDraft,
	type WorkoutEditorDraft,
} from "../../shared/workout-editor-draft";
import { WorkoutEditorSaveInputSchema } from "../../shared/workout-editor-operations";
import { controllerHarness } from "../../tests/client/controller-harness";
import { exerciseOccurrence, liveDraft, startTime } from "../../tests/client/draft-fixtures";
import { isWorkoutEditorSaving } from "./controller-types";

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

	it.live("admits one caller before persistence and stays busy through acknowledged cleanup", () =>
		Effect.gen(function* () {
			const writing = yield* Deferred.make<void>();
			const releaseWrite = yield* Deferred.make<void>();
			const invoking = yield* Deferred.make<void>();
			const releaseInvoke = yield* Deferred.make<void>();
			const cleaning = yield* Deferred.make<void>();
			const releaseCleanup = yield* Deferred.make<void>();
			const secondStarted = yield* Deferred.make<void>();
			const submitted = saveInput();
			const result = { sets: [], kind: "saved" as const, entityId: EntityId.make("saved-workout") };
			let preparations = 0;
			const harness = createController({
				remove: Deferred.succeed(cleaning, undefined).pipe(
					Effect.andThen(Deferred.await(releaseCleanup)),
				),
				onWrite: (value) =>
					Effect.gen(function* () {
						const decoded = decodeWorkoutEditorDraft(value);
						if (decoded._tag === "Success" && decoded.success.submission !== undefined) {
							yield* Deferred.succeed(writing, undefined);
							yield* Deferred.await(releaseWrite);
						}
					}),
				save: () =>
					Effect.gen(function* () {
						const stored = decodeWorkoutEditorDraft(harness.stored);
						expect(stored._tag === "Success" && stored.success.submission).toEqual(submitted);
						yield* Deferred.succeed(invoking, undefined);
						yield* Deferred.await(releaseInvoke);
						return result;
					}),
			});
			yield* harness.controller.load();
			yield* harness.controller.start(draft());
			const first = yield* Effect.forkChild(
				harness.controller.save((current) =>
					Effect.sync(() => {
						preparations += 1;
						return { input: submitted, draft: current.draft };
					}),
				),
			);
			yield* Deferred.await(writing);
			expect(isWorkoutEditorSaving(harness.controller.getSnapshot())).toBe(true);
			expect(harness.submissions).toHaveLength(0);
			const second = yield* Effect.forkChild(
				Effect.gen(function* () {
					yield* Deferred.succeed(secondStarted, undefined);
					return yield* harness.controller.save((current) =>
						Effect.sync(() => {
							preparations += 1;
							return { draft: current.draft, input: saveInput("other") };
						}),
					);
				}),
			);
			yield* Deferred.await(secondStarted);
			expect(yield* Fiber.join(second)).toBeUndefined();
			expect(preparations).toBe(1);
			expect(yield* harness.controller.discard()).toBe(false);
			yield* Deferred.succeed(releaseWrite, undefined);
			yield* Deferred.await(invoking);
			expect(harness.submissions).toEqual([submitted]);
			yield* Deferred.succeed(releaseInvoke, undefined);
			yield* Deferred.await(cleaning);
			expect(harness.controller.getSnapshot().saveState).toEqual({
				result,
				cleaning: true,
				phase: "acknowledged",
			});
			expect(isWorkoutEditorSaving(harness.controller.getSnapshot())).toBe(true);
			expect(
				harness.controller.change((current) => ({ ...current, name: "Must stay frozen" })),
			).toBe(false);
			expect(yield* harness.controller.discard()).toBe(false);
			expect(yield* harness.controller.save(() => Effect.die("must decline"))).toBeUndefined();
			yield* Deferred.succeed(releaseCleanup, undefined);
			expect(yield* Fiber.join(first)).toEqual(result);
			expect(isWorkoutEditorSaving(harness.controller.getSnapshot())).toBe(false);
			expect(harness.stored).toBeNull();
			expect(harness.controller.getSnapshot().status).toBe("empty");
			expect(harness.submissions).toHaveLength(1);
		}),
	);

	it.live("retains acknowledgement across remount and retries only failed local cleanup", () =>
		Effect.gen(function* () {
			let failRemoval = true;
			const result = { sets: [], kind: "saved" as const, entityId: EntityId.make("saved-workout") };
			const states: boolean[] = [];
			const harness = createController({
				save: () => Effect.succeed(result),
				remove: Effect.suspend(() => (failRemoval ? Effect.fail("quota") : Effect.void)),
			});
			harness.controller.subscribe(() => {
				states.push(isWorkoutEditorSaving(harness.controller.getSnapshot()));
			});
			yield* harness.controller.load();
			yield* harness.controller.start(draft());
			const failed = yield* Effect.exit(
				harness.controller.save((current) =>
					Effect.succeed({ input: saveInput(), draft: current.draft }),
				),
			);
			expect(failed._tag).toBe("Failure");
			expect(harness.controller.getSnapshot().saveState).toEqual({
				result,
				cleaning: false,
				phase: "acknowledged",
			});
			harness.controller.dispose();
			yield* harness.controller.load();
			expect(harness.reads).toBe(1);
			expect(harness.controller.getSnapshot().saveState).toEqual({
				result,
				cleaning: false,
				phase: "acknowledged",
			});
			expect(yield* harness.controller.discard()).toBe(false);
			expect(harness.controller.change((current) => ({ ...current, name: "Unsafe edit" }))).toBe(
				false,
			);
			states.length = 0;
			failRemoval = false;
			expect(yield* harness.controller.save(() => Effect.die("must not rebuild"))).toEqual(result);
			expect(states.slice(0, -1).every(Boolean)).toBe(true);
			expect(states.at(-1)).toBe(false);
			expect(harness.submissions).toEqual([saveInput()]);
			expect(harness.removals).toBe(2);
			expect(harness.stored).toBeNull();
			expect(harness.controller.getSnapshot().saveState).toEqual({ result, phase: "saved" });
			expect(yield* harness.controller.start(draft("Next workout"))).toBe(true);
			expect(harness.controller.getSnapshot().saveState).toEqual({ phase: "idle" });
		}),
	);

	it.live("keeps an uncertain submission frozen and retries identical input after recovery", () =>
		Effect.gen(function* () {
			const submitted = saveInput();
			const harness = createController({ save: () => Effect.fail("transport") });
			yield* harness.controller.load();
			yield* harness.controller.start(draft());
			expect(
				(yield* Effect.exit(
					harness.controller.save((current) =>
						Effect.succeed({ input: submitted, draft: current.draft }),
					),
				))._tag,
			).toBe("Failure");
			expect(isWorkoutEditorSaving(harness.controller.getSnapshot())).toBe(false);
			expect(harness.controller.change((current) => ({ ...current, name: "Unsafe edit" }))).toBe(
				false,
			);
			expect(yield* harness.controller.discard()).toBe(false);
			expect(
				(yield* Effect.exit(harness.controller.save(() => Effect.die("must use frozen input"))))
					._tag,
			).toBe("Failure");
			expect(harness.submissions).toEqual([submitted, submitted]);
			const recovered = createController({
				stored: harness.stored,
				save: () => Effect.succeed({ kind: "pro-required" }),
			});
			yield* recovered.controller.load();
			expect(yield* recovered.controller.save(() => Effect.die("must use durable input"))).toEqual({
				kind: "pro-required",
			});
			expect(recovered.submissions).toEqual([submitted]);
			expect(
				recovered.controller.change((current) => ({ ...current, name: "Corrected retry" })),
			).toBe(true);
		}),
	);

	it.live(
		"does not invoke until its frozen submission is durable, including persistence retries",
		() =>
			Effect.gen(function* () {
				let failWrite = false;
				const submitted = saveInput();
				const harness = createController({
					save: () => Effect.succeed({ kind: "conflict" }),
					onWrite: () => (failWrite ? Effect.fail("quota") : Effect.void),
				});
				yield* harness.controller.load();
				yield* harness.controller.start(draft());
				failWrite = true;
				expect(
					(yield* Effect.exit(
						harness.controller.save((current) =>
							Effect.succeed({ input: submitted, draft: current.draft }),
						),
					))._tag,
				).toBe("Failure");
				expect(harness.submissions).toHaveLength(0);
				expect(harness.controller.change((current) => ({ ...current, name: "Unsafe edit" }))).toBe(
					false,
				);
				failWrite = false;
				expect(yield* harness.controller.save(() => Effect.die("must retry frozen input"))).toEqual(
					{ kind: "conflict" },
				);
				expect(harness.submissions).toEqual([submitted]);
			}),
	);

	it.live("unlocks and persists only definite business rejections", () =>
		Effect.gen(function* () {
			for (const result of [
				{ kind: "invalid", code: "missing-measurement" },
				{ kind: "conflict" },
				{ kind: "pro-required" },
			] as const) {
				const harness = createController({ save: () => Effect.succeed(result) });
				yield* harness.controller.load();
				yield* harness.controller.start(draft());
				expect(
					yield* harness.controller.save((current) =>
						Effect.succeed({ input: saveInput(), draft: current.draft }),
					),
				).toEqual(result);
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
			}
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

	it.live("persists invalid expiry without confirmation, progression, or prompted rest", () =>
		Effect.gen(function* () {
			for (const prompt of [false, true]) {
				let now = Date.parse(startTime);
				const harness = createController({ now: Effect.sync(() => now) });
				const running: WorkoutEditorDraft = {
					...timerDraft(),
					activeSetId: "set-1",
					activeOccurrenceId: "occurrence-1",
					localPreferences: { promptForRestTimer: prompt },
					occurrences: [
						exerciseOccurrence("duration", {
							duration: "20",
							restChoice: { kind: "explicit", seconds: "invalid" },
						}),
						exerciseOccurrence(
							"duration",
							{ duration: "20", clientId: "next-set" },
							{ isCollapsed: true, clientId: "next-occurrence" },
						),
					],
				};
				yield* harness.controller.load();
				yield* harness.controller.start(running);
				now += 20_500;
				yield* harness.controller.reconcile({ executionClientId: "execution-1" });
				const persisted = decodeWorkoutEditorDraft(harness.stored);
				expect(persisted._tag).toBe("Success");
				if (persisted._tag === "Success") {
					expect({
						rest: persisted.success.restCountdown,
						activeSetId: persisted.success.activeSetId,
						pendingRest: persisted.success.pendingRest,
						execution: persisted.success.executionCountdown,
						activeOccurrenceId: persisted.success.activeOccurrenceId,
						occurrences: persisted.success.occurrences.map(({ sets, isCollapsed }) => ({
							isCollapsed,
							sets: sets.map(({ included, confirmedAt, restTimerStartedAt }) => ({
								included,
								confirmedAt,
								restTimerStartedAt,
							})),
						})),
					}).toEqual({
						rest: undefined,
						activeSetId: "set-1",
						execution: undefined,
						pendingRest: undefined,
						activeOccurrenceId: "occurrence-1",
						occurrences: [
							{
								isCollapsed: false,
								sets: [{ included: false, confirmedAt: undefined, restTimerStartedAt: undefined }],
							},
							{
								isCollapsed: true,
								sets: [{ included: false, confirmedAt: undefined, restTimerStartedAt: undefined }],
							},
						],
					});
				}
				const writes = harness.writes.length;
				yield* harness.controller.reconcile();
				expect(harness.writes).toHaveLength(writes);
			}
		}),
	);
});
