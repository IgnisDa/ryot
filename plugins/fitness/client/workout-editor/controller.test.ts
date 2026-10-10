import { describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	PluginId,
	PluginPackageId,
	type PluginDeviceRequest,
	type PluginDeviceResult,
	type PluginNavigationTarget,
} from "@ryot-app/plugin-client-sdk/plugin";
import { Schema } from "@ryot-app/plugin-kit/effect";
import * as Deferred from "effect/Deferred";

import {
	WorkoutEditorDraftSchema,
	decodeWorkoutEditorDraft,
} from "../../shared/workout-editor-draft";
import { WorkoutEditorSaveInputSchema } from "../../shared/workout-editor-operations";
import { createWorkoutEditorController } from "./controller";

const startTime = "2026-10-15T10:00:00.000Z";

const draft = (name = "Session") =>
	Schema.decodeSync(WorkoutEditorDraftSchema)({
		name,
		images: [],
		videos: [],
		supersets: [],
		occurrences: [],
		activeDuration: 0,
		draftId: "draft-1",
		startedAt: startTime,
		mode: { kind: "live" },
		displayEnergyUnit: "kcal",
		activeDurationIntent: "set",
		kind: "fitness-workout-editor",
		activeDurationStartedAt: startTime,
	});

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
	Schema.decodeSync(WorkoutEditorDraftSchema)({
		images: [],
		videos: [],
		supersets: [],
		name: "Session",
		activeDuration: 0,
		draftId: "draft-1",
		startedAt: startTime,
		mode: { kind: "live" },
		displayEnergyUnit: "kcal",
		activeDurationIntent: "set",
		kind: "fitness-workout-editor",
		activeDurationStartedAt: startTime,
		executionCountdown: {
			setId: "set-1",
			durationSeconds: 20,
			clientId: "execution-1",
			exerciseId: "exercise-1",
			occurrenceId: "occurrence-1",
			deadline: "2026-10-15T10:00:20.000Z",
		},
		occurrences: [
			{
				notes: [],
				images: [],
				videos: [],
				isCollapsed: false,
				exerciseId: "exercise-1",
				clientId: "occurrence-1",
				exerciseKind: "duration",
				sets: [
					{
						duration: "20",
						included: false,
						setLot: "normal",
						clientId: "set-1",
						exerciseKind: "duration",
						restChoice: { kind: "inherited" },
					},
				],
			},
		],
	});

const createController = (
	options: {
		readonly device?: (request: PluginDeviceRequest) => Effect.Effect<PluginDeviceResult>;
		readonly events?: string[];
		readonly onRead?: () => unknown;
		readonly now?: Effect.Effect<number, unknown>;
		readonly onRemove?: () => void;
		readonly onWrite?: (value: string) => Effect.Effect<void, unknown>;
		readonly pluginId?: PluginId;
		readonly target?: PluginNavigationTarget;
	} = {},
) => {
	let stored: unknown = null;
	const writes: string[] = [];
	let reads = 0;
	let removals = 0;
	const controller = createWorkoutEditorController({
		device: options.device,
		target: options.target,
		pluginId: options.pluginId,
		now: options.now ?? Effect.succeed(Date.parse(startTime)),
		storage: {
			read: Effect.sync(() => {
				reads += 1;
				return options.onRead?.() ?? stored;
			}),
			remove: Effect.sync(() => {
				removals += 1;
				options.onRemove?.();
				stored = null;
			}),
			write: (value) =>
				Effect.gen(function* () {
					writes.push(value);
					options.events?.push("write");
					if (options.onWrite !== undefined) {
						yield* options.onWrite(value);
					}
					stored = value;
				}),
		},
	});
	return {
		writes,
		controller,
		get reads() {
			return reads;
		},
		get stored() {
			return stored;
		},
		get removals() {
			return removals;
		},
	};
};

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
					canEdit: true,
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

	it.live("does not unlock an earlier uncertain save when a retry fails preflight", () =>
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
			expect(
				yield* harness.controller.rejectSubmission({ canEdit: true, kind: "pro-required" }),
			).toBe(false);
			expect(
				harness.controller.change((current) => ({ ...current, name: "Must remain frozen" })),
			).toBe(false);
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

	it.live(
		"reschedules muted alerts, retains inexact availability, and reconciles a recovered deadline once",
		() =>
			Effect.gen(function* () {
				let now = Date.parse(startTime);
				const requests: PluginDeviceRequest[] = [];
				const harness = createController({
					now: Effect.sync(() => now),
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
