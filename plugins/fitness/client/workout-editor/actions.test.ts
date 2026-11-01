import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import {
	type WorkoutEditorDraft,
	WorkoutEditorDraftSchema,
	type WorkoutEditorOccurrence,
	type WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import type { WorkoutPreferenceSettings } from "../../shared/workout-editor-preferences";
import {
	changeOccurrenceDisplay,
	completeWorkoutSet,
	cycleWorkoutSuperset,
	editSet,
	finishWorkoutDraft,
	newWorkoutOccurrence,
	newWorkoutSet,
	nextWorkoutOccurrence,
	reconcileWorkoutTimers,
	removeWorkoutItems,
	resolvePendingRest,
	workoutProgressTarget,
} from "./actions";
import { pauseCountdown, pauseWorkout, resumeStopwatch, startExecution, startRest } from "./timers";

const startedAt = "2026-10-16T10:00:00.000Z";
const startTime = Date.parse(startedAt);

const workoutSet = (clientId: string, overrides: Record<string, unknown> = {}) => ({
	clientId,
	reps: "5",
	weight: "10",
	included: false,
	setLot: "normal",
	exerciseKind: "reps_and_weight",
	restChoice: { kind: "inherited" },
	...overrides,
});

const workoutOccurrence = (clientId: string, overrides: Record<string, unknown> = {}) => ({
	clientId,
	notes: [],
	images: [],
	videos: [],
	isCollapsed: false,
	exerciseKind: "reps_and_weight",
	exerciseId: `${clientId}-exercise`,
	sets: [workoutSet(`${clientId}-set`)],
	...overrides,
});

const workoutDraft = (overrides: Record<string, unknown> = {}): Effect.Effect<WorkoutEditorDraft> =>
	Schema.decodeUnknownEffect(WorkoutEditorDraftSchema)({
		startedAt,
		images: [],
		videos: [],
		supersets: [],
		name: "Workout",
		activeDuration: 0,
		draftId: "draft-1",
		mode: { kind: "live" },
		displayEnergyUnit: "kcal",
		activeDurationIntent: "set",
		kind: "fitness-workout-editor",
		activeDurationStartedAt: startedAt,
		occurrences: [workoutOccurrence("occurrence-1")],
		...overrides,
	}).pipe(Effect.orDie);

const findOccurrence = (
	value: WorkoutEditorDraft,
	occurrenceId: string,
): WorkoutEditorOccurrence => {
	const result = value.occurrences.find(({ clientId }) => clientId === occurrenceId);
	assert(result);
	return result;
};

const findSet = (
	value: WorkoutEditorDraft,
	occurrenceId: string,
	setId: string,
): WorkoutEditorSet => {
	const result = findOccurrence(value, occurrenceId).sets.find(
		({ clientId }) => clientId === setId,
	);
	assert(result);
	return result;
};

const preferences = (
	overrides: Partial<WorkoutPreferenceSettings> = {},
): WorkoutPreferenceSettings => ({
	dropRestTime: 0,
	warmUpRestTime: 0,
	muteSounds: false,
	normalRestTime: 60,
	failureRestTime: 0,
	energyUnit: "kcal",
	unitSystem: "metric",
	promptForRestTimer: false,
	startTimerForDurationExercises: false,
	...overrides,
});

const isoAt = (time: number) => new Date(time).toISOString();

const executionDraft = () =>
	Effect.map(
		workoutDraft({
			activeSetId: "first-set",
			activeOccurrenceId: "first",
			supersets: [{ color: "blue", clientId: "superset", occurrenceIds: ["first", "second"] }],
			occurrences: [
				workoutOccurrence("first", {
					sets: [workoutSet("first-set", { duration: "20" })],
					display: { weightUnit: "kg", distanceUnit: "km", durationUnit: "seconds" },
				}),
				workoutOccurrence("second", { isCollapsed: true }),
			],
		}),
		(draft) => startExecution(draft, "first", "first-set", startTime, "execution").draft,
	);

describe("workout timer reconciliation", () => {
	it.effect.each(
		[
			{ reps: "5", rest: "30" },
			{ reps: "5", rest: "invalid" },
			{ reps: "", rest: "30" },
			{ reps: "-1", rest: "invalid" },
		].flatMap((measurements) =>
			[false, true].flatMap((prompt) =>
				[500, 1500, 60_000].flatMap((delay) =>
					[false, true].map((stale) => Object.assign({}, measurements, { delay, stale, prompt })),
				),
			),
		),
	)(
		"reconciles rest=$rest reps=$reps prompt=$prompt delay=$delay stale=$stale atomically",
		({ rest, reps, delay, stale, prompt }) =>
			Effect.gen(function* () {
				const running = editSet(yield* executionDraft(), "first", "first-set", (set) => ({
					...set,
					reps,
					restChoice: { seconds: rest, kind: "explicit" },
				}));
				const deadline = startTime + 20_000;
				const result = reconcileWorkoutTimers(running, deadline + delay, {
					prompt,
					settings: preferences(),
					expected: { executionClientId: stale ? "replaced-execution" : "execution" },
				});
				const completed = !stale && rest === "30" && reps === "5";
				const set = findSet(result.draft, "first", "first-set");
				expect({
					included: set.included,
					feedback: result.feedback,
					confirmedAt: set.confirmedAt,
					rest: result.draft.restCountdown,
					restStartedAt: set.restTimerStartedAt,
					activeSetId: result.draft.activeSetId,
					pendingRest: result.draft.pendingRest,
					activeOccurrenceId: result.draft.activeOccurrenceId,
					executionId: result.draft.executionCountdown?.clientId,
					firstCollapsed: findOccurrence(result.draft, "first").isCollapsed,
					secondCollapsed: findOccurrence(result.draft, "second").isCollapsed,
				}).toEqual({
					included: completed,
					firstCollapsed: completed,
					secondCollapsed: !completed,
					feedback: completed && delay < 1500,
					executionId: stale ? "execution" : undefined,
					activeOccurrenceId: completed ? "second" : "first",
					activeSetId: completed ? "second-set" : "first-set",
					confirmedAt: completed ? isoAt(deadline) : undefined,
					restStartedAt: completed && !prompt ? isoAt(deadline) : undefined,
					pendingRest:
						completed && prompt
							? {
									seconds: 30,
									setId: "first-set",
									occurrenceId: "first",
									exerciseId: EntityId.make("first-exercise"),
								}
							: undefined,
					rest:
						completed && !prompt && delay < 1500
							? {
									setId: "first-set",
									durationSeconds: 30,
									occurrenceId: "first",
									clientId: "execution:rest",
									deadline: isoAt(deadline + 30_000),
									exerciseId: EntityId.make("first-exercise"),
								}
							: undefined,
				});
				expect(result.changed).toBe(!stale);
				if (!stale) {
					const repeated = reconcileWorkoutTimers(result.draft, deadline + delay, {
						prompt,
						settings: preferences(),
						expected: { executionClientId: "execution" },
					});
					expect(repeated).toEqual({ changed: false, feedback: false, draft: result.draft });
				}
			}),
	);

	it.effect("invalidates a replaced execution target before attempting completion", () =>
		Effect.gen(function* () {
			const running = yield* executionDraft();
			const replaced = {
				...running,
				occurrences: running.occurrences.map((occurrence) =>
					occurrence.clientId === "first"
						? Object.assign({}, occurrence, { exerciseId: EntityId.make("replacement-exercise") })
						: occurrence,
				),
			};
			const result = reconcileWorkoutTimers(replaced, startTime + 20_000, {
				prompt: true,
				settings: preferences(),
			});
			expect(result.draft).toEqual({ ...replaced, executionCountdown: undefined });
			expect(result.feedback).toBe(false);
		}),
	);

	it.effect.each(["running", "expired", "paused", "stale"])(
		"keeps independent %s rest, workout pause, and stopwatch state on invalid execution expiry",
		(state) =>
			Effect.gen(function* () {
				const value = editSet(yield* executionDraft(), "first", "first-set", (set) => ({
					...set,
					restChoice: { kind: "explicit", seconds: "invalid" },
				}));
				const included = editSet(value, "second", "second-set", (set) => ({
					...set,
					included: true,
				}));
				const resting = startRest(
					included,
					"second",
					"second-set",
					state === "running" ? 30 : 20,
					startTime,
					"independent-rest",
				).draft;
				const pausedRest =
					state === "paused"
						? pauseCountdown(resting, "restCountdown", startTime + 5_000).draft
						: resting;
				const pausedWorkout = pauseWorkout(
					resumeStopwatch(pausedRest, startTime).draft,
					startTime + 5_000,
				).draft;
				const result = reconcileWorkoutTimers(pausedWorkout, startTime + 20_500, {
					prompt: true,
					settings: preferences(),
					expected:
						state === "stale"
							? { restClientId: "old-rest", executionClientId: "execution" }
							: undefined,
				});
				expect(result.draft).toEqual({
					...pausedWorkout,
					executionCountdown: undefined,
					restCountdown: state === "expired" ? undefined : pausedWorkout.restCountdown,
				});
				expect(result.feedback).toBe(state === "expired");
			}),
	);

	it.effect("does not complete a paused execution even after its old deadline", () =>
		Effect.gen(function* () {
			const paused = pauseCountdown(
				yield* executionDraft(),
				"executionCountdown",
				startTime + 5_000,
			).draft;
			expect(
				reconcileWorkoutTimers(paused, startTime + 60_000, {
					prompt: true,
					settings: preferences(),
				}),
			).toEqual({ draft: paused, changed: false, feedback: false });
		}),
	);

	it.effect(
		"does not expire the new rest when execution replaces an overdue independent rest",
		() =>
			Effect.gen(function* () {
				const value = yield* executionDraft();
				const included = editSet(value, "second", "second-set", (set) => ({
					...set,
					included: true,
				}));
				const resting = startRest(
					included,
					"second",
					"second-set",
					20,
					startTime,
					"old-rest",
				).draft;
				const completed = reconcileWorkoutTimers(resting, startTime + 20_500, {
					prompt: false,
					settings: preferences(),
				});
				expect(findSet(completed.draft, "first", "first-set").confirmedAt).toBe(
					isoAt(startTime + 20_000),
				);
				expect(completed.draft.activeOccurrenceId).toBeUndefined();
				expect(completed.draft.restCountdown).toMatchObject({
					clientId: "execution:rest",
					deadline: isoAt(startTime + 80_000),
				});
				const stale = reconcileWorkoutTimers(completed.draft, startTime + 80_000, {
					prompt: false,
					settings: preferences(),
					expected: { restClientId: "old-rest" },
				});
				expect(stale).toEqual({ changed: false, feedback: false, draft: completed.draft });
			}),
	);
});

describe("workout editor actions", () => {
	it.effect(
		"stays on an ordinary exercise until its sets are complete and leaves finished supersets",
		() =>
			Effect.gen(function* () {
				const ordinary = yield* workoutDraft({
					occurrences: [workoutOccurrence("first"), workoutOccurrence("next")],
				});
				expect(nextWorkoutOccurrence(ordinary, "first")).toBe("first");
				const grouped = yield* workoutDraft({
					supersets: [{ color: "blue", clientId: "group", occurrenceIds: ["second", "first"] }],
					occurrences: [
						workoutOccurrence("first", { sets: [workoutSet("set-first", { included: true })] }),
						workoutOccurrence("second", { sets: [workoutSet("set-second", { included: true })] }),
						workoutOccurrence("next"),
					],
				});
				expect(nextWorkoutOccurrence(grouped, "second")).toBe("next");
				expect(cycleWorkoutSuperset(grouped, "first")).toBe("second");
				expect(cycleWorkoutSuperset(grouped, "second")).toBe("first");
			}),
	);
	it.effect(
		"converts measurements between display units and back without changing quantities",
		() =>
			Effect.gen(function* () {
				const original = findOccurrence(
					yield* workoutDraft({
						occurrences: [
							workoutOccurrence("occurrence-1", {
								display: { weightUnit: "kg", distanceUnit: "km", durationUnit: "seconds" },
								sets: [workoutSet("set-1", { weight: "75", distance: "10", duration: "120" })],
							}),
						],
					}),
					"occurrence-1",
				);
				const imperial = changeOccurrenceDisplay(original, {
					weightUnit: "lb",
					distanceUnit: "mi",
					durationUnit: "minutes",
				});
				const converted = imperial.sets[0];
				assert(converted);
				expect(Number(converted.weight)).toBeCloseTo(75 / 0.45359237);
				expect(Number(converted.distance)).toBeCloseTo(10 / 1.609344);
				expect(Number(converted.duration)).toBe(2);

				const metric = changeOccurrenceDisplay(imperial, {
					weightUnit: "kg",
					distanceUnit: "km",
					durationUnit: "seconds",
				});
				const restored = metric.sets[0];
				assert(restored);
				expect(Number(restored.weight)).toBeCloseTo(75);
				expect(Number(restored.distance)).toBeCloseTo(10);
				expect(Number(restored.duration)).toBe(120);
			}),
	);

	it.effect("keeps blank and invalid measurement strings unchanged during unit conversion", () =>
		Effect.gen(function* () {
			const original = findOccurrence(
				yield* workoutDraft({
					occurrences: [
						workoutOccurrence("occurrence-1", {
							display: { weightUnit: "kg", distanceUnit: "km", durationUnit: "seconds" },
							sets: [workoutSet("set-1", { weight: "", distance: "  ", duration: "not-a-number" })],
						}),
					],
				}),
				"occurrence-1",
			);
			const converted = changeOccurrenceDisplay(original, {
				weightUnit: "lb",
				distanceUnit: "mi",
				durationUnit: "minutes",
			});
			expect(converted.sets[0]).toMatchObject({
				weight: "",
				distance: "  ",
				duration: "not-a-number",
			});
		}),
	);

	it.effect("copies measurements into a new set and clears saved and completed set data", () =>
		Effect.gen(function* () {
			const previous = findSet(
				yield* workoutDraft({
					occurrences: [
						workoutOccurrence("occurrence-1", {
							sets: [
								workoutSet("saved-set", {
									rpe: "9",
									reps: "8",
									weight: "80",
									distance: "4",
									duration: "30",
									included: true,
									setLot: "drop",
									eventId: "event-1",
									occurredAt: startedAt,
									confirmedAt: startedAt,
									note: "Keep form steady",
									restTimerStartedAt: startedAt,
									restChoice: { seconds: "45", kind: "explicit" },
								}),
							],
						}),
					],
				}),
				"occurrence-1",
				"saved-set",
			);

			expect(newWorkoutSet("new-set", "reps_and_weight", previous)).toEqual({
				reps: "8",
				weight: "80",
				distance: "4",
				duration: "30",
				included: false,
				setLot: "normal",
				clientId: "new-set",
				exerciseKind: "reps_and_weight",
				restChoice: { kind: "inherited" },
			});
		}),
	);

	it.effect(
		"removes selected workout items, repairs small groups, and preserves retained event IDs",
		() =>
			Effect.gen(function* () {
				const original = yield* workoutDraft({
					supersets: [
						{
							color: "crimson",
							clientId: "small-group",
							occurrenceIds: ["remove-occurrence", "keep-occurrence"],
						},
						{
							color: "blue",
							clientId: "retained-group",
							occurrenceIds: ["remove-occurrence", "keep-occurrence", "last-occurrence"],
						},
					],
					occurrences: [
						workoutOccurrence("remove-occurrence", {
							sets: [workoutSet("removed-occurrence-set", { eventId: "event-removed-occurrence" })],
						}),
						workoutOccurrence("keep-occurrence", {
							sets: [
								workoutSet("keep-set", { eventId: "event-keep" }),
								workoutSet("remove-set", { eventId: "event-removed-set" }),
							],
						}),
						workoutOccurrence("last-occurrence", {
							sets: [workoutSet("last-set", { eventId: "event-last" })],
						}),
					],
				});

				const result = removeWorkoutItems(original, ["remove-occurrence"], ["remove-set"]);
				expect(result.occurrences.map(({ clientId }) => clientId)).toEqual([
					"keep-occurrence",
					"last-occurrence",
				]);
				expect(
					findOccurrence(result, "keep-occurrence").sets.map(({ clientId }) => clientId),
				).toEqual(["keep-set"]);
				expect(findSet(result, "keep-occurrence", "keep-set").eventId).toBe("event-keep");
				expect(findSet(result, "last-occurrence", "last-set").eventId).toBe("event-last");
				expect(result.supersets).toEqual([
					{
						color: "blue",
						clientId: "retained-group",
						occurrenceIds: ["keep-occurrence", "last-occurrence"],
					},
				]);
			}),
	);

	it.effect(
		"cycles through workout-order group members, skips completed sets, and treats repeated exercises separately",
		() =>
			Effect.gen(function* () {
				const value = yield* workoutDraft({
					supersets: [
						{
							color: "teal",
							clientId: "group-1",
							occurrenceIds: ["occurrence-3", "occurrence-1", "occurrence-2"],
						},
					],
					occurrences: [
						workoutOccurrence("occurrence-1", { exerciseId: "repeated-exercise" }),
						workoutOccurrence("occurrence-2", {
							exerciseId: "repeated-exercise",
							sets: [workoutSet("completed-set", { included: true })],
						}),
						workoutOccurrence("occurrence-3", { exerciseId: "repeated-exercise" }),
						workoutOccurrence("outside-group"),
					],
				});

				expect(nextWorkoutOccurrence(value, "occurrence-1")).toBe("occurrence-3");
				expect(nextWorkoutOccurrence(value, "occurrence-3")).toBe("occurrence-1");
			}),
	);

	it.effect("confirms zero measurements and starts inherited rest at the completion time", () =>
		Effect.gen(function* () {
			const value = yield* workoutDraft({
				occurrences: [
					workoutOccurrence("occurrence-1", {
						sets: [workoutSet("set-1", { reps: "0", weight: "0" })],
					}),
				],
			});
			const result = completeWorkoutSet(value, {
				prompt: false,
				overrides: {},
				setId: "set-1",
				now: startTime,
				timerId: "rest-1",
				occurrenceId: "occurrence-1",
				settings: preferences({ normalRestTime: 30 }),
			});

			expect(findSet(result, "occurrence-1", "set-1")).toMatchObject({
				reps: "0",
				weight: "0",
				included: true,
				occurredAt: startedAt,
				confirmedAt: startedAt,
				restTimerStartedAt: startedAt,
				restChoice: { seconds: "30", kind: "explicit" },
			});
			expect(result.restCountdown).toMatchObject({
				clientId: "rest-1",
				durationSeconds: 30,
				deadline: isoAt(startTime + 30_000),
			});
		}),
	);

	it.effect("uses an explicit rest choice instead of changed normal rest preferences", () =>
		Effect.gen(function* () {
			const value = yield* workoutDraft({
				occurrences: [
					workoutOccurrence("occurrence-1", {
						sets: [workoutSet("set-1", { restChoice: { seconds: "7", kind: "explicit" } })],
					}),
				],
			});
			const result = completeWorkoutSet(value, {
				prompt: false,
				setId: "set-1",
				now: startTime,
				timerId: "rest-1",
				occurrenceId: "occurrence-1",
				overrides: { normalRestTime: 45 },
				settings: preferences({ normalRestTime: 90 }),
			});

			expect(findSet(result, "occurrence-1", "set-1")).toMatchObject({
				restTimerStartedAt: startedAt,
				restChoice: { seconds: "7", kind: "explicit" },
			});
			expect(result.restCountdown).toMatchObject({ durationSeconds: 7 });
		}),
	);

	it.effect("advances immediately when the resolved rest is zero", () =>
		Effect.gen(function* () {
			const value = yield* workoutDraft({
				occurrences: [workoutOccurrence("occurrence-1"), workoutOccurrence("occurrence-2")],
			});
			const result = completeWorkoutSet(value, {
				prompt: true,
				overrides: {},
				now: startTime,
				timerId: "rest-1",
				setId: "occurrence-1-set",
				occurrenceId: "occurrence-1",
				settings: preferences({ normalRestTime: 0 }),
			});

			expect(result.pendingRest).toBeUndefined();
			expect(result.restCountdown).toBeUndefined();
			expect(result.activeOccurrenceId).toBe("occurrence-2");
			expect(findSet(result, "occurrence-1", "occurrence-1-set").restTimerStartedAt).toBe(
				startedAt,
			);
		}),
	);

	it.effect("keeps prompted rest pending until it starts or is skipped", () =>
		Effect.gen(function* () {
			const value = yield* workoutDraft({
				occurrences: [workoutOccurrence("occurrence-1"), workoutOccurrence("occurrence-2")],
			});
			const prompted = completeWorkoutSet(value, {
				prompt: true,
				overrides: {},
				now: startTime,
				timerId: "rest-1",
				setId: "occurrence-1-set",
				occurrenceId: "occurrence-1",
				settings: preferences({ normalRestTime: 20 }),
			});
			expect(prompted.pendingRest).toEqual({
				seconds: 20,
				setId: "occurrence-1-set",
				occurrenceId: "occurrence-1",
				exerciseId: "occurrence-1-exercise",
			});
			expect(prompted.restCountdown).toBeUndefined();
			expect(prompted.activeOccurrenceId).toBe("occurrence-2");
			expect(findOccurrence(prompted, "occurrence-1").isCollapsed).toBe(true);
			expect(findOccurrence(prompted, "occurrence-2").isCollapsed).toBe(false);
			expect(
				findSet(prompted, "occurrence-1", "occurrence-1-set").restTimerStartedAt,
			).toBeUndefined();

			const started = resolvePendingRest(prompted, startTime + 1_000, "prompted-rest", false);
			expect(started.pendingRest).toBeUndefined();
			expect(started.activeOccurrenceId).toBe("occurrence-2");
			expect(started.activeSetId).toBe(prompted.activeSetId);
			expect(started.restCountdown?.deadline).toBe(isoAt(startTime + 21_000));
			expect(findSet(started, "occurrence-1", "occurrence-1-set").restTimerStartedAt).toBe(
				isoAt(startTime + 1_000),
			);

			const skipped = resolvePendingRest(prompted, startTime + 1_000, "unused-rest", true);
			expect(skipped.pendingRest).toBeUndefined();
			expect(skipped.restCountdown).toBeUndefined();
			expect(skipped.activeOccurrenceId).toBe("occurrence-2");
			expect(
				findSet(skipped, "occurrence-1", "occurrence-1-set").restTimerStartedAt,
			).toBeUndefined();
		}),
	);

	it.effect("collapses the final exercise without reopening it or selecting a completed set", () =>
		Effect.gen(function* () {
			const result = completeWorkoutSet(yield* workoutDraft(), {
				prompt: false,
				overrides: {},
				now: startTime,
				timerId: "rest-final",
				setId: "occurrence-1-set",
				occurrenceId: "occurrence-1",
				settings: preferences({ normalRestTime: 0 }),
			});
			expect(findOccurrence(result, "occurrence-1").isCollapsed).toBe(true);
			expect(result.activeOccurrenceId).toBeUndefined();
			expect(result.activeSetId).toBeUndefined();
			expect(workoutProgressTarget(result)).toBeUndefined();
		}),
	);

	it.effect("uses the cyclic superset destination for the highlighted and upcoming set", () =>
		Effect.gen(function* () {
			const draft = yield* workoutDraft({
				supersets: [{ color: "blue", clientId: "superset", occurrenceIds: ["first", "second"] }],
				occurrences: [
					workoutOccurrence("first", { sets: [workoutSet("first-1"), workoutSet("first-2")] }),
					workoutOccurrence("second", { isCollapsed: true }),
				],
			});
			const result = completeWorkoutSet(draft, {
				prompt: true,
				overrides: {},
				now: startTime,
				timerId: "rest",
				setId: "first-1",
				occurrenceId: "first",
				settings: preferences({ normalRestTime: 20 }),
			});
			expect(workoutProgressTarget(result)?.occurrence.clientId).toBe("second");
			expect(workoutProgressTarget(result)?.set.clientId).toBe("second-set");
			expect(findOccurrence(result, "first").isCollapsed).toBe(false);
			expect(findOccurrence(result, "second").isCollapsed).toBe(false);
		}),
	);

	it.effect(
		"unconfirms an erased measurement and cancels its rest without changing other sets",
		() =>
			Effect.gen(function* () {
				const draft = yield* workoutDraft({
					pendingRest: {
						seconds: 20,
						setId: "occurrence-1-set",
						occurrenceId: "occurrence-1",
						exerciseId: "occurrence-1-exercise",
					},
					occurrences: [
						workoutOccurrence("occurrence-1", {
							sets: [
								workoutSet("occurrence-1-set", { included: true, confirmedAt: startedAt }),
								workoutSet("second"),
							],
						}),
					],
				});
				const result = editSet(draft, "occurrence-1", "occurrence-1-set", (set) => ({
					...set,
					reps: "",
				}));
				expect(findSet(result, "occurrence-1", "occurrence-1-set")).toMatchObject({
					reps: "",
					included: false,
				});
				expect(findSet(result, "occurrence-1", "second")).toEqual(
					findSet(draft, "occurrence-1", "second"),
				);
				expect(findSet(result, "occurrence-1", "occurrence-1-set").confirmedAt).toBeUndefined();
				expect(result.pendingRest).toBeUndefined();
			}),
	);

	it.effect(
		"does not leave a rest countdown overdue when completion is observed after the full rest",
		() =>
			Effect.gen(function* () {
				const result = completeWorkoutSet(yield* workoutDraft(), {
					prompt: false,
					overrides: {},
					now: startTime,
					timerId: "rest-1",
					setId: "occurrence-1-set",
					occurrenceId: "occurrence-1",
					observedAt: startTime + 60_000,
					settings: preferences({ normalRestTime: 60 }),
				});

				expect(result.restCountdown).toBeUndefined();
				expect(findSet(result, "occurrence-1", "occurrence-1-set").restTimerStartedAt).toBe(
					startedAt,
				);
			}),
	);

	it.effect("finishes a live workout with elapsed active time and clears its workout timers", () =>
		Effect.gen(function* () {
			const value = yield* workoutDraft({
				activeDuration: 300,
				activeDurationStartedAt: isoAt(startTime + 900_000),
				pendingRest: {
					seconds: 30,
					setId: "occurrence-1-set",
					occurrenceId: "occurrence-1",
					exerciseId: "occurrence-1-exercise",
				},
				restCountdown: {
					clientId: "rest-1",
					durationSeconds: 30,
					setId: "occurrence-1-set",
					occurrenceId: "occurrence-1",
					exerciseId: "occurrence-1-exercise",
					deadline: isoAt(startTime + 1_230_000),
				},
				executionCountdown: {
					durationSeconds: 30,
					clientId: "execution-1",
					setId: "occurrence-1-set",
					occurrenceId: "occurrence-1",
					exerciseId: "occurrence-1-exercise",
					deadline: isoAt(startTime + 1_230_000),
				},
			});
			const result = finishWorkoutDraft(value, startTime + 1_200_000);

			expect(result.endedAt).toBe(isoAt(startTime + 1_200_000));
			expect(result.activeDuration).toBe(600);
			expect(result.activeDurationStartedAt).toBeUndefined();
			expect(result.pendingRest).toBeUndefined();
			expect(result.restCountdown).toBeUndefined();
			expect(result.executionCountdown).toBeUndefined();
		}),
	);

	it.effect("leaves template and historical drafts unchanged when finish is requested", () =>
		Effect.gen(function* () {
			const template = yield* workoutDraft({ mode: { kind: "template-create" } });
			const historical = yield* workoutDraft({
				mode: { kind: "historical", entityId: "workout-1", conflictToken: "conflict-1" },
			});

			expect(finishWorkoutDraft(template, startTime + 60_000)).toBe(template);
			expect(finishWorkoutDraft(historical, startTime + 60_000)).toBe(historical);
		}),
	);

	it.effect("resolves a new occurrence display from unit and exercise preferences", () =>
		Effect.gen(function* () {
			const value = newWorkoutOccurrence({
				setId: "new-set",
				id: "new-occurrence",
				kind: "reps_and_weight",
				overrides: { defaultDurationUnit: "seconds" },
				settings: preferences({ unitSystem: "imperial" }),
				exerciseId: findOccurrence(yield* workoutDraft(), "occurrence-1").exerciseId,
			});

			expect(value.display).toMatchObject({
				weightUnit: "lb",
				distanceUnit: "mi",
				durationUnit: "seconds",
			});
		}),
	);
});
