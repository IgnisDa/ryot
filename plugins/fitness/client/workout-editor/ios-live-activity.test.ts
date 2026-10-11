import { describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId, type PluginIosLiveActivityRequest } from "@ryot-app/plugin-client-sdk/plugin";
import { Deferred } from "effect";

import { controllerHarness } from "../../tests/client/controller-harness";
import { exerciseOccurrence, liveDraft, startTime } from "../../tests/client/draft-fixtures";
import { iosLiveActivityHarness } from "../../tests/client/ios-live-activity-harness";
import { completeWorkoutSet } from "./actions";
import { workoutIosActivityContent, workoutIosActivityKey } from "./ios-live-activity";
import { createWorkoutIosActivitySynchronizer } from "./ios-live-activity-sync";

const names = new Map([["exercise-1", "Bench Press"]]);
const now = Date.parse(startTime);
const publicationSchedule = Effect.gen(function* () {
	const run = Effect.runCallbackWith(yield* Effect.context());
	return {
		after: () => () => undefined,
		run: (work: Effect.Effect<void>, onExit: () => void) => run(work, { onExit }),
	};
});
const countdown = {
	setId: "set-1",
	clientId: "timer-1",
	durationSeconds: 60,
	occurrenceId: "occurrence-1",
	deadline: "2026-10-15T10:01:00.000Z",
	exerciseId: exerciseOccurrence("reps").exerciseId,
};

describe("workout iOS Live Activity", () => {
	it("projects display units and ignores private notes, media, and measurements", () => {
		const draft = liveDraft({
			comment: "private",
			caloriesBurnt: "1234",
			occurrences: [
				exerciseOccurrence("reps_and_weight", {
					reps: "8",
					weight: "80",
					note: "private set note",
				}),
			],
		});
		const content = workoutIosActivityContent(draft, names);
		expect(content.detail).toBe("Next: Bench Press · Set 1 · 80 kg · 8 reps");
		expect(content.primary).toEqual({ kind: "elapsed", label: "Active", startedAt: startTime });
		expect(content.metrics).toEqual([{ value: "0/1", label: "Sets" }]);
		expect(JSON.stringify(content)).not.toContain("private");
		expect(JSON.stringify(content)).not.toContain("1234");
		const imperial = {
			...draft,
			occurrences: [
				exerciseOccurrence(
					"reps_and_weight",
					{ reps: "8", weight: "175" },
					{ display: { weightUnit: "lb", distanceUnit: "mi", durationUnit: "seconds" } },
				),
			],
		};
		expect(workoutIosActivityContent(imperial, names).detail).toBe(
			"Next: Bench Press · Set 1 · 175 lb · 8 reps",
		);
	});

	it("preserves independent workout and countdown pauses without per-second publications", () => {
		const content = workoutIosActivityContent(
			liveDraft({
				activeDuration: 90,
				restCountdown: countdown,
				activeDurationStartedAt: undefined,
			}),
			names,
		);
		expect(content.primary).toEqual({
			label: "Resting",
			kind: "countdown",
			startedAt: startTime,
			deadline: countdown.deadline,
		});
		expect(content.secondary).toEqual({ seconds: 90, label: "Active", kind: "duration" });
		expect(content.status).toBe("Resting · workout paused");
		expect(content.staleAt).toBe(countdown.deadline);
		expect(content.staleMessage).toBe("Rest complete");
		const paused = workoutIosActivityContent(
			liveDraft({ restCountdown: { ...countdown, pausedRemainingSeconds: 21 } }),
			names,
		);
		expect(paused.primary).toEqual({ seconds: 21, kind: "duration", label: "Resting" });
		expect(paused.staleAt).toBeUndefined();
	});

	it("includes only confirmed sets in volume and excludes explicit pauses from active time", () => {
		const occurrence = exerciseOccurrence("reps_and_weight", {
			reps: "8",
			weight: "80",
			included: true,
		});
		const draft = liveDraft({
			activeDuration: 120,
			activeDurationStartedAt: "2026-10-15T10:05:00.000Z",
			occurrences: [
				{
					...occurrence,
					sets: [
						...occurrence.sets,
						...exerciseOccurrence("reps_and_weight", {
							reps: "10",
							weight: "100",
							clientId: "pending",
						}).sets,
					],
				},
			],
		});
		const content = workoutIosActivityContent(draft, names);
		expect(content.metrics).toEqual([
			{ value: "1/2", label: "Sets" },
			{ label: "Volume", value: "640 kg" },
		]);
		expect(content.primary).toEqual({
			label: "Active",
			kind: "elapsed",
			startedAt: "2026-10-15T10:03:00.000Z",
		});
	});

	it("prioritizes execution, rest prompt, and rest over the stopwatch", () => {
		const base = liveDraft({
			restCountdown: countdown,
			stopwatchStartedAt: startTime,
			pendingRest: { ...countdown, seconds: 60 },
		});
		expect(workoutIosActivityContent(base, names).status).toBe("Set completed · Rest for 1:00?");
		const working = workoutIosActivityContent({ ...base, executionCountdown: countdown }, names);
		expect(working.status).toBe("Working");
		expect(working.detail).toBe("Bench Press");
		expect(working.staleAt).toBe(countdown.deadline);
		expect(working.staleMessage).toBe("Set timer complete");
		expect(working.secondary).toEqual({ kind: "elapsed", label: "Active", startedAt: startTime });
	});

	it("uses superset progression and does not label an incomplete save as saved", () => {
		const first = exerciseOccurrence("reps", { reps: "8" });
		const second = exerciseOccurrence(
			"reps",
			{ reps: "10", clientId: "set-2" },
			{ clientId: "occurrence-2" },
		);
		const draft = liveDraft({
			occurrences: [first, second],
			activeOccurrenceId: first.clientId,
			supersets: [
				{ color: "crimson", clientId: "group", occurrenceIds: [first.clientId, second.clientId] },
			],
		});
		const advanced = completeWorkoutSet(draft, {
			now,
			prompt: false,
			overrides: {},
			setId: "set-1",
			timerId: "rest",
			occurrenceId: first.clientId,
			settings: { normalRestTime: 0 },
		});
		expect(workoutIosActivityContent(advanced, names).detail).toContain("Set 1");
		expect(advanced.activeOccurrenceId).toBe(second.clientId);
		const unsaved = workoutIosActivityContent(
			{ ...advanced, endedAt: countdown.deadline, activeDurationStartedAt: undefined },
			names,
		);
		expect(unsaved.status).toBe("Workout not saved yet");
	});

	it.effect(
		"persists before publishing, deduplicates content, and retains activities on controller disposal",
		() =>
			Effect.gen(function* () {
				const events: string[] = [];
				const published = yield* Deferred.make<void>();
				const native = iosLiveActivityHarness({
					onRequest: (request) => events.push(request.action),
					beforeRequest: (request) =>
						request.action === "start"
							? Deferred.succeed(published, undefined).pipe(Effect.asVoid)
							: Effect.void,
				});
				const state = controllerHarness({
					events,
					iosLiveActivities: native.api,
					schedule: yield* publicationSchedule,
				});
				yield* state.controller.load();
				events.length = 0;
				yield* state.controller.start(liveDraft());
				yield* Deferred.await(published);
				expect(events.indexOf("write")).toBeLessThan(events.indexOf("start"));
				yield* state.controller.flush();
				expect(native.requests.filter(({ action }) => action === "start")).toHaveLength(1);
				expect(native.requests.filter(({ action }) => action === "update")).toHaveLength(0);
				state.controller.dispose();
				expect(native.activities.get(workoutIosActivityKey(liveDraft()))?.state).toBe("active");
			}),
	);

	it.effect("reattaches after recovery and never recreates dismissed or over-age sessions", () =>
		Effect.gen(function* () {
			const key = workoutIosActivityKey(liveDraft());
			for (const activityState of ["active", "stale", "dismissed", "ended"] as const) {
				const native = iosLiveActivityHarness({ activities: [{ key, state: activityState }] });
				const sync = createWorkoutIosActivitySynchronizer({
					now: Effect.succeed(now),
					iosLiveActivities: native.api,
					pluginId: PluginId.make("fitness"),
				});
				yield* sync.synchronize(liveDraft(), names);
				expect(native.requests.filter(({ action }) => action === "start")).toEqual([]);
				expect(native.requests.filter(({ action }) => action === "update")).toHaveLength(
					activityState === "active" || activityState === "stale" ? 1 : 0,
				);
			}
			const native = iosLiveActivityHarness();
			const old = createWorkoutIosActivitySynchronizer({
				iosLiveActivities: native.api,
				pluginId: PluginId.make("fitness"),
				now: Effect.succeed(now + 8 * 60 * 60 * 1000),
			});
			yield* old.synchronize(liveDraft(), names);
			expect(native.requests.filter(({ action }) => action === "start")).toEqual([]);
		}),
	);

	it.effect(
		"makes no native changes for malformed listings and retries with complete inventory",
		() =>
			Effect.gen(function* () {
				const key = workoutIosActivityKey(liveDraft());
				for (const malformed of [
					{ status: "done" },
					{ status: "done", activities: null },
					{ status: "done", activities: [{ key, state: "invalid" }] },
					{
						status: "done",
						activities: [
							{ state: "active", key: "previous-session" },
							{ key, state: "invalid" },
						],
					},
					{ status: "active" },
					{ activities: [], status: "active" },
					{ activities: [], status: "unsupported" },
				]) {
					let response: unknown = malformed;
					const native = iosLiveActivityHarness({
						listResult: () => response,
						activities: [
							{ key, state: "active" },
							{ state: "stale", key: "previous-session" },
						],
					});
					const sync = createWorkoutIosActivitySynchronizer({
						now: Effect.succeed(now),
						iosLiveActivities: native.api,
						pluginId: PluginId.make("fitness"),
					});
					yield* sync.synchronize(liveDraft(), names);
					expect(native.requests.map(({ action }) => action)).toEqual(["list"]);
					expect([...native.activities.values()]).toEqual([
						{ key, state: "active" },
						{ state: "stale", key: "previous-session" },
					]);
					response = { status: "done", activities: [...native.activities.values()] };
					yield* sync.synchronize(liveDraft(), names);
					expect(native.requests.map(({ action }) => action)).toEqual([
						"list",
						"list",
						"end",
						"update",
					]);
					expect([...native.activities.values()]).toEqual([
						{ key, state: "active" },
						{ state: "ended", key: "previous-session" },
					]);
				}
			}),
	);

	it.effect(
		"starts from an empty inventory and stops native work when listing is unsupported",
		() =>
			Effect.gen(function* () {
				const native = iosLiveActivityHarness();
				const sync = createWorkoutIosActivitySynchronizer({
					now: Effect.succeed(now),
					iosLiveActivities: native.api,
					pluginId: PluginId.make("fitness"),
				});
				yield* sync.synchronize(liveDraft(), names);
				expect(native.requests.map(({ action }) => action)).toEqual(["list", "start"]);
				const unsupported = iosLiveActivityHarness({
					listResult: () => ({ status: "unsupported" }),
				});
				const unavailable = createWorkoutIosActivitySynchronizer({
					now: Effect.succeed(now),
					iosLiveActivities: unsupported.api,
					pluginId: PluginId.make("fitness"),
				});
				yield* unavailable.synchronize(liveDraft(), names);
				yield* unavailable.synchronize(liveDraft(), names);
				yield* unavailable.finish(liveDraft(), names, false);
				expect(unsupported.requests.map(({ action }) => action)).toEqual(["list"]);
			}),
	);

	it.effect(
		"ends discarded sessions immediately and saved sessions with a short final summary",
		() =>
			Effect.gen(function* () {
				const ended = yield* Deferred.make<void>();
				const native = iosLiveActivityHarness({
					beforeRequest: (request) =>
						request.action === "end"
							? Deferred.succeed(ended, undefined).pipe(Effect.asVoid)
							: Effect.void,
				});
				const state = controllerHarness({
					iosLiveActivities: native.api,
					schedule: yield* publicationSchedule,
				});
				yield* state.controller.load();
				yield* state.controller.start(liveDraft());
				yield* state.controller.discard();
				yield* Deferred.await(ended);
				expect(native.requests.at(-1)).toEqual({
					action: "end",
					content: undefined,
					dismissalSeconds: 0,
					key: workoutIosActivityKey(liveDraft()),
					pluginId: PluginId.make("fitness-installation"),
				});
				const saved = createWorkoutIosActivitySynchronizer({
					iosLiveActivities: native.api,
					now: Effect.succeed(now + 90_000),
					pluginId: PluginId.make("fitness"),
				});
				yield* saved.finish(
					liveDraft({
						activeDuration: 90,
						draftId: "saved-draft",
						activeDurationStartedAt: undefined,
					}),
					names,
					true,
				);
				const final = native.requests.at(-1);
				expect(final?.action === "end" && final.dismissalSeconds).toBe(30);
				expect(final?.action === "end" && final.content?.status).toBe("Workout saved");
				expect(final?.action === "end" && final.content?.primary).toEqual({
					seconds: 90,
					label: "Active",
					kind: "duration",
				});
			}),
	);

	it.effect("never blocks persistence or discard when the iOS capability fails", () =>
		Effect.gen(function* () {
			const native = iosLiveActivityHarness({ fails: true });
			const state = controllerHarness({
				iosLiveActivities: native.api,
				schedule: yield* publicationSchedule,
			});
			yield* state.controller.load();
			expect(yield* state.controller.start(liveDraft())).toBe(true);
			expect(state.writes).toHaveLength(1);
			expect(yield* state.controller.discard()).toBe(true);
		}),
	);

	it.effect(
		"keeps persistence independent of pending native work and orders discard after publication",
		() =>
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const ended = yield* Deferred.make<void>();
				const native = iosLiveActivityHarness({
					beforeRequest: Effect.fnUntraced(function* (request: PluginIosLiveActivityRequest) {
						if (request.action === "start") {
							yield* Deferred.succeed(started, undefined);
							yield* Deferred.await(release);
						} else if (request.action === "end") {
							yield* Deferred.succeed(ended, undefined);
						}
					}),
				});
				const state = controllerHarness({
					iosLiveActivities: native.api,
					schedule: yield* publicationSchedule,
				});
				yield* state.controller.load();
				expect(yield* state.controller.start(liveDraft())).toBe(true);
				yield* Deferred.await(started);
				state.controller.change((draft) => ({ ...draft, name: "Updated" }));
				yield* state.controller.flush();
				expect(state.writes).toHaveLength(2);
				expect(yield* state.controller.discard()).toBe(true);
				expect(state.read()).toBeNull();
				yield* Deferred.succeed(release, undefined);
				yield* Deferred.await(ended);
				expect(native.requests.at(-1)?.action).toBe("end");
			}),
	);
});
