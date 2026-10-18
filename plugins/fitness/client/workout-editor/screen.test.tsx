import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { ClientPageContext } from "@ryot-app/plugin-client-contract";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId, type PluginNavigationTarget } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	waitForMessagePortMacrotask,
} from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { act } from "react";

import type { ExerciseKind } from "../../shared/exercise-kinds";
import {
	MeasurementReadingLogInput,
	measurementReadingLogOperationSlug,
} from "../../shared/measurement-reading-operations";
import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	workoutEditorContextOperationSlug,
	workoutEditorSaveOperationSlug,
} from "../../shared/workout-editor-context-operations";
import {
	decodeWorkoutEditorDraft,
	encodeWorkoutEditorDraft,
	WorkoutEditorDraftSchema,
} from "../../shared/workout-editor-draft";
import { WorkoutEditorScreen } from "./screen";

const startedAt = "2026-10-16T10:00:00.000Z";
const startedAtMillis = Date.parse(startedAt);
const pluginId = PluginId.make("fitness-owner");
const target: PluginNavigationTarget = {
	search: "",
	kind: "plugin-route",
	path: "/workout-editor",
	packageId: PLUGIN_PACKAGE_ID,
};

const exerciseKinds = [
	{ kind: "reps", id: "exercise-reps", name: "Reps exercise" },
	{ kind: "duration", id: "exercise-duration", name: "Duration exercise" },
	{ kind: "reps_and_weight", name: "Weight exercise", id: "exercise-reps-and-weight" },
	{ kind: "reps_and_duration", name: "Timed reps exercise", id: "exercise-reps-and-duration" },
	{
		name: "Distance exercise",
		kind: "distance_and_duration",
		id: "exercise-distance-and-duration",
	},
	{
		name: "Combined exercise",
		kind: "reps_and_duration_and_distance",
		id: "exercise-reps-and-duration-and-distance",
	},
] as const;

const exerciseDetails = exerciseKinds.map(({ id, kind, name }) => ({ id, kind, name }));

const defaultMeasurements: Record<ExerciseKind, Record<string, string>> = {
	reps: { reps: "12" },
	duration: { duration: "45" },
	reps_and_weight: { reps: "8", weight: "20" },
	reps_and_duration: { reps: "8", duration: "45" },
	distance_and_duration: { distance: "2", duration: "20" },
	reps_and_duration_and_distance: { reps: "4", duration: "60", distance: "1.5" },
};

const editorSet = (
	clientId: string,
	kind: ExerciseKind,
	overrides: Record<string, unknown> = {},
) => ({
	clientId,
	included: false,
	setLot: "normal",
	exerciseKind: kind,
	restChoice: { kind: "inherited" },
	...defaultMeasurements[kind],
	...overrides,
});

const editorOccurrence = (
	kind: ExerciseKind,
	sets = [editorSet(`set-${kind}`, kind)],
	clientId = `occurrence-${kind}`,
) => ({
	sets,
	clientId,
	notes: [],
	images: [],
	videos: [],
	isCollapsed: false,
	exerciseKind: kind,
	exerciseId: `exercise-${kind.replaceAll("_", "-")}`,
	display: { weightUnit: "kg", distanceUnit: "km", durationUnit: "seconds" },
});

const editorDraft = (occurrences: readonly unknown[], overrides: Record<string, unknown> = {}) =>
	Schema.decodeUnknownSync(WorkoutEditorDraftSchema)({
		startedAt,
		images: [],
		videos: [],
		occurrences,
		supersets: [],
		activeDuration: 0,
		mode: { kind: "live" },
		name: "Recovered workout",
		displayEnergyUnit: "kcal",
		activeDurationIntent: "set",
		kind: "fitness-workout-editor",
		draftId: "draft-workout-editor",
		activeDurationStartedAt: startedAt,
		...overrides,
	});

const pageContext: ClientPageContext = {
	target,
	view: null,
	settings: {},
	dataSources: null,
	route: { params: {} },
	renderer: { pluginId, kind: "plugin", exportName: "workout-editor" },
	contributors: [pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID })],
};

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

type EditorStorage = { value: JsonValue | null };

const previousWeightSet = {
	rpe: 8,
	reps: 7,
	pace: null,
	note: null,
	weight: 80,
	oneRm: null,
	setOrder: 0,
	volume: null,
	restTime: null,
	duration: null,
	distance: null,
	setLot: "normal",
	exerciseOrder: 0,
	id: "previous-set",
	workoutId: "previous-workout",
	recordedKind: "reps_and_weight",
	occurredAt: "2026-10-10T10:00:00.000Z",
	exerciseId: "exercise-reps-and-weight",
	workoutStartedAt: "2026-10-10T10:00:00.000Z",
};

const openEditor = (
	clock: ReturnType<typeof createTestRyotClock>,
	storage: EditorStorage,
	metrics: readonly MeasurementSummary[] = [],
	screenProps: Omit<Parameters<typeof WorkoutEditorScreen>[0], "target"> = {},
	proAvailable = true,
	previousSets: readonly Record<string, unknown>[] = [],
	historySessions: readonly Record<string, unknown>[] = [],
	pickerExercises: readonly Record<string, unknown>[] = [],
) => {
	let respond: (() => void) | undefined;
	const page = mountPluginPage(() => <WorkoutEditorScreen target={target} {...screenProps} />, {
		page: pageContext,
		bootstrap: clock.bootstrap,
		onClientMessage: () => respond?.(),
		location: routeLocation(target.path),
	});
	const answered = new Set<string>();
	const saveInputs: JsonValue[] = [];
	const saveListeners = new Set<(input: JsonValue) => void>();
	const saveRequested = Effect.callback<JsonValue>((resume) => {
		const saved = saveInputs[0];
		if (saved !== undefined) {
			resume(Effect.succeed(saved));
			return Effect.void;
		}
		const listener = (input: JsonValue) => resume(Effect.succeed(input));
		saveListeners.add(listener);
		return Effect.sync(() => {
			saveListeners.delete(listener);
		});
	});
	const readingInputs: JsonValue[] = [];
	const deviceRequests: Array<{ action: string; enabled?: boolean }> = [];
	const storageActions: string[] = [];
	type QuerySuccess = Extract<
		Parameters<typeof page.replyQuery>[1],
		{ readonly outcome: "success" }
	>;
	type QueryData = QuerySuccess["response"]["data"];
	const answerPending = () => {
		for (const request of page.clientMessages()) {
			if (!("requestId" in request) || answered.has(request.requestId)) {
				continue;
			}
			answered.add(request.requestId);
			if (request.type === "storage-request") {
				storageActions.push(request.action);
				if (request.action === "set") {
					storage.value = request.value;
				} else if (request.action === "remove") {
					storage.value = null;
				}
				page.send({
					outcome: "success",
					type: "storage-result",
					requestId: request.requestId,
					value: request.action === "get" ? storage.value : null,
				});
			} else if (request.type === "device-request") {
				deviceRequests.push(
					"enabled" in request
						? { action: request.action, enabled: request.enabled }
						: { action: request.action },
				);
				page.send({
					outcome: "success",
					type: "device-result",
					requestId: request.requestId,
					value: { status: request.action === "schedule" ? "scheduled" : "done" },
				});
			} else if (request.type === "ios-live-activity-request") {
				page.send({
					outcome: "success",
					requestId: request.requestId,
					value: { status: "unsupported" },
					type: "ios-live-activity-result",
				});
			} else if (request.type === "background-operation-request") {
				if (request.operationSlug === measurementReadingLogOperationSlug) {
					readingInputs.push(request.input);
				}
				page.send({
					outcome: "success",
					requestId: request.requestId,
					type: "background-operation-accepted",
					submissionId: `submission-${request.idempotencyKey}`,
				});
			} else if (request.type === "operation-request") {
				if (request.operationSlug === workoutEditorSaveOperationSlug) {
					saveInputs.push(request.input);
				}
				let value: JsonValue = { sets: [], kind: "saved", entityId: "saved-workout" };
				if (request.operationSlug === workoutEditorContextOperationSlug) {
					value = {
						proAvailable,
						settings: {
							dropRestTime: 0,
							muteSounds: true,
							warmUpRestTime: 0,
							failureRestTime: 0,
							normalRestTime: 20,
							energyUnit: "kcal",
							unitSystem: "metric",
							promptForRestTimer: false,
							startTimerForDurationExercises: false,
						},
					};
				} else if (request.operationSlug === measurementReadingLogOperationSlug) {
					value = { count: 2, status: "saved" };
				}
				page.send({
					value,
					outcome: "success",
					type: "operation-result",
					requestId: request.requestId,
				});
				if (request.operationSlug === workoutEditorSaveOperationSlug) {
					saveListeners.forEach((listener) => listener(request.input));
				}
			} else if (request.type === "ryotql-request") {
				const data: Record<string, QueryData[string]> = {};
				for (const queryName of Object.keys(request.document.queries)) {
					if (
						queryName === "exercises" &&
						JSON.stringify(request.document).includes("pickerExercise")
					) {
						data[queryName] = rows(pickerExercises);
					} else if (queryName === "exercises") {
						data[queryName] = rows(
							exerciseDetails.map(({ id, kind, name }) => ({
								id,
								name,
								images: null,
								instructions: null,
								properties: { kind },
							})),
						);
					} else if (queryName === "metrics") {
						data[queryName] = rows(metrics);
					} else if (queryName === "sets") {
						data[queryName] = rows(previousSets);
					} else if (queryName === "workouts") {
						data[queryName] = rows(historySessions);
					} else {
						data[queryName] = rows([]);
					}
				}
				page.replyQuery(request.requestId, { outcome: "success", response: { data } });
			}
		}
	};
	respond = answerPending;
	return {
		page,
		saveInputs,
		saveRequested,
		readingInputs,
		answerPending,
		deviceRequests,
		storageActions,
	};
};

const waitForEditor = Effect.fnUntraced(function* (answerPending: () => void) {
	for (let turn = 0; turn < 100; turn += 1) {
		answerPending();
		yield* waitForMessagePortMacrotask;
		if (screen.queryByRole("region", { name: "Weight exercise" }) !== null) {
			return;
		}
	}
	expect(screen.getByRole("region", { name: "Weight exercise" })).toBeTruthy();
});

const inputValue = (element: HTMLElement) => {
	assert(element instanceof HTMLInputElement);
	return element.value;
};

const click = (element: Element) =>
	act(() => {
		fireEvent.click(element);
	});

const change = (element: Element, value: string) =>
	act(() => {
		fireEvent.change(element, { target: { value } });
	});

const dismissOverlay = (page: ReturnType<typeof mountPluginPage>, requestId: string) =>
	act(() => {
		page.send({ requestId, type: "dismiss-overlay" });
	});

afterEach(disposePluginBridges);

const pickerExercise = (id: string, name: string, kind: ExerciseKind | null) => ({
	id,
	kind,
	name,
	videos: null,
	images: null,
	targets: rows([]),
	instructions: null,
	equipment: rows([]),
	membershipProperties: null,
});

describe("WorkoutEditorScreen", () => {
	it.live("appends a pending exercise once and clears the add request", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const storage: EditorStorage = {
					value: encodeWorkoutEditorDraft(editorDraft([editorOccurrence("reps_and_weight")])),
				};
				const { page, answerPending } = openEditor(
					clock,
					storage,
					[],
					{ pendingAddExerciseId: "exercise-reps" },
					true,
					[],
					[],
					[pickerExercise("exercise-reps", "Reps exercise", "reps")],
				);
				yield* waitForEditor(answerPending);
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(screen.getByRole("region", { name: "Reps exercise" })).toBeTruthy();
						expect(page.clientMessages()).toContainEqual({
							mode: "replace",
							type: "navigate",
							target: expect.objectContaining({ path: "/workout-editor" }),
						});
					}),
				);
				for (let turn = 0; turn < 10; turn += 1) {
					answerPending();
					yield* waitForMessagePortMacrotask;
				}
				const decoded = decodeWorkoutEditorDraft(storage.value);
				assert(decoded._tag === "Success");
				expect(decoded.success.occurrences.map(({ exerciseId }) => exerciseId)).toEqual([
					"exercise-reps-and-weight",
					"exercise-reps",
				]);
				expect(page.clientMessages().filter(({ type }) => type === "navigate")).toHaveLength(1);
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live(
		"reports a pending exercise that is not in the library and still clears the request",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				try {
					yield* Effect.promise(() => clock.setTime(startedAtMillis));
					const storage: EditorStorage = {
						value: encodeWorkoutEditorDraft(editorDraft([editorOccurrence("reps_and_weight")])),
					};
					const { page, answerPending } = openEditor(clock, storage, [], {
						pendingAddExerciseId: "exercise-missing",
					});
					yield* waitForEditor(answerPending);
					yield* Effect.promise(() =>
						waitFor(() => {
							answerPending();
							expect(screen.getByText(/not in your library/)).toBeTruthy();
							expect(page.clientMessages().some(({ type }) => type === "navigate")).toBe(true);
						}),
					);
					const decoded = decodeWorkoutEditorDraft(storage.value);
					assert(decoded._tag === "Success");
					expect(decoded.success.occurrences).toHaveLength(1);
				} finally {
					disposePluginBridges();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
	it.live("does not offer to discard an existing draft for unavailable template creation", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				let prepared = 0;
				const storage: EditorStorage = {
					value: encodeWorkoutEditorDraft(editorDraft([editorOccurrence("reps_and_weight")])),
				};
				const { answerPending } = openEditor(
					clock,
					storage,
					[],
					{
						requiresPro: true,
						prepareDraft: () =>
							Effect.sync(() => {
								prepared += 1;
								return editorDraft([]);
							}),
					},
					false,
				);
				yield* waitForEditor(answerPending);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("dialog", { name: "Templates require Pro" })).toBeTruthy(),
					),
				);
				expect(screen.queryByRole("button", { name: "Discard and start" })).toBeNull();
				expect(prepared).toBe(0);
				const decoded = decodeWorkoutEditorDraft(storage.value);
				assert(decoded._tag === "Success");
				expect(decoded.success.draftId).toBe("draft-workout-editor");
			} finally {
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
	it.live(
		"guards a requested action before preparing its source and resumes the stored draft",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				try {
					yield* Effect.promise(() => clock.setTime(startedAtMillis));
					let prepared = 0;
					let resumed = 0;
					const storage: EditorStorage = {
						value: encodeWorkoutEditorDraft(editorDraft([editorOccurrence("reps_and_weight")])),
					};
					const { answerPending } = openEditor(clock, storage, [], {
						onStarted: () => {
							resumed += 1;
						},
						prepareDraft: () =>
							Effect.sync(() => {
								prepared += 1;
								return editorDraft([]);
							}),
					});
					yield* waitForEditor(answerPending);
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(
								screen.getByRole("dialog", { name: "You have a workout in progress" }),
							).toBeTruthy(),
						),
					);
					expect(prepared).toBe(0);
					click(screen.getByRole("button", { name: "Resume workout" }));
					expect(resumed).toBe(1);
					expect(prepared).toBe(0);
					expect(
						screen.queryByRole("dialog", { name: "You have a workout in progress" }),
					).toBeNull();
				} finally {
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
	it.live("discards an existing draft before preparing and storing the requested action once", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				let prepared = 0;
				let started = 0;
				const requested = editorDraft([editorOccurrence("reps_and_weight")], {
					draftId: "requested",
					name: "Requested workout",
				});
				const storage: EditorStorage = {
					value: encodeWorkoutEditorDraft(editorDraft([editorOccurrence("reps_and_weight")])),
				};
				const { answerPending } = openEditor(clock, storage, [], {
					onStarted: () => {
						started += 1;
					},
					prepareDraft: () =>
						Effect.sync(() => {
							prepared += 1;
							return requested;
						}),
				});
				yield* waitForEditor(answerPending);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							screen.getByRole("dialog", { name: "You have a workout in progress" }),
						).toBeTruthy(),
					),
				);
				click(screen.getByRole("button", { name: "Discard and start" }));
				yield* waitForEditor(answerPending);
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(started).toBe(1);
					}),
				);
				expect(prepared).toBe(1);
				const decoded = decodeWorkoutEditorDraft(storage.value);
				assert(decoded._tag === "Success");
				expect(decoded.success.draftId).toBe("requested");
				expect(screen.queryByRole("dialog", { name: "You have a workout in progress" })).toBeNull();
			} finally {
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
	it.live("saves zero and other measurements independently before discarding the workout", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const metrics: MeasurementSummary[] = [
					{
						unit: "kg",
						id: "weight",
						key: "weight",
						firstAt: null,
						rangeCount: 0,
						name: "Weight",
						latestAt: null,
						latestValue: null,
						pinnedAt: startedAt,
					},
					{
						unit: "cm",
						id: "waist",
						key: "waist",
						name: "Waist",
						firstAt: null,
						rangeCount: 0,
						latestAt: null,
						latestValue: null,
						pinnedAt: startedAt,
					},
				];
				const storage: EditorStorage = {
					value: encodeWorkoutEditorDraft(editorDraft([editorOccurrence("reps_and_weight")])),
				};
				const { page, saveInputs, answerPending, readingInputs } = openEditor(
					clock,
					storage,
					metrics,
				);
				yield* waitForEditor(answerPending);
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(
							screen.getByRole("button", { name: "Log measurement" }).hasAttribute("disabled"),
						).toBe(false);
					}),
				);
				click(screen.getByRole("button", { name: "Log measurement" }));
				const dialog = screen.getByRole("dialog", { name: "Log measurement" });
				change(within(dialog).getByRole("textbox", { name: "Weight (kg)" }), "0");
				change(within(dialog).getByRole("textbox", { name: "Waist (cm)" }), "82");
				change(
					within(dialog).getByRole("textbox", { name: /Comment\s*\(optional\)/ }),
					"During workout",
				);
				click(within(dialog).getByRole("button", { name: "Save" }));
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(screen.queryByRole("dialog", { name: "Log measurement" })).toBeNull();
					}),
				);
				expect(readingInputs).toHaveLength(1);
				const submitted = yield* Schema.decodeUnknownEffect(MeasurementReadingLogInput)(
					readingInputs[0],
				);
				expect(submitted.values).toEqual([
					{ value: 82, metricId: "waist" },
					{ value: 0, metricId: "weight" },
				]);
				expect(submitted.comment).toBe("During workout");
				click(screen.getByRole("button", { name: "Discard workout" }));
				click(
					within(screen.getByRole("dialog", { name: "Discard workout?" })).getByRole("button", {
						name: "Discard workout",
					}),
				);
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(storage.value).toBeNull();
					}),
				);
				expect(readingInputs).toHaveLength(1);
				expect(saveInputs).toEqual([]);
				expect(
					page
						.clientMessages()
						.filter(
							(message) =>
								message.type === "operation-request" ||
								message.type === "background-operation-request",
						)
						.map((message) => message.operationSlug),
				).not.toContain("measurement-reading-delete");
				page.dispose();
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
	it.live("previews occurrence images, plays videos, and keeps removals local to the draft", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const image = { type: "remote", url: "https://assets.test/form.jpg" };
				const video = { type: "remote", url: "https://assets.test/form.mp4" };
				const storage: EditorStorage = {
					value: encodeWorkoutEditorDraft(
						editorDraft([
							{ ...editorOccurrence("reps_and_weight"), images: [image], videos: [video] },
						]),
					),
				};
				const { page, saveInputs, answerPending } = openEditor(clock, storage);
				yield* waitForEditor(answerPending);
				const exercise = screen.getByRole("region", { name: "Weight exercise" });
				click(within(exercise).getByRole("button", { name: "Weight exercise actions" }));
				click(screen.getByRole("menuitem", { name: "Attachments (2)" }));
				const panel = screen.getByRole("dialog", { name: "Attachments for Weight exercise" });
				const player = within(panel).getByLabelText("Weight exercise video 2");
				expect(player.getAttribute("src")).toBe(video.url);
				expect(player.hasAttribute("controls")).toBe(true);
				click(within(panel).getByRole("button", { name: "Preview Weight exercise image 1" }));
				expect(
					screen.getByRole("dialog", { name: "Preview Weight exercise image 1" }),
				).toBeTruthy();
				dismissOverlay(page, "close-image-preview");
				yield* waitForMessagePortMacrotask;
				click(within(panel).getByRole("button", { name: "Remove image 1" }));
				dismissOverlay(page, "close-media-panel");
				yield* waitForMessagePortMacrotask;
				for (let turn = 0; turn < 10; turn += 1) {
					answerPending();
					yield* waitForMessagePortMacrotask;
				}
				const decoded = decodeWorkoutEditorDraft(storage.value);
				assert(decoded._tag === "Success");
				expect(decoded.success.occurrences[0]?.images).toEqual([]);
				expect(decoded.success.occurrences[0]?.videos).toEqual([video]);
				expect(saveInputs).toEqual([]);
				expect(
					page.clientMessages().filter((message) => message.type === "upload-request"),
				).toEqual([]);
				page.dispose();
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
	it.live(
		"offers independent measurement logging in live workouts but not historical or template editors",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				try {
					yield* Effect.promise(() => clock.setTime(startedAtMillis));
					for (const mode of [
						{ kind: "live" },
						{ kind: "historical", entityId: "saved-workout", conflictToken: "baseline" },
						{ kind: "template-create" },
					]) {
						const { page, answerPending } = openEditor(clock, {
							value: encodeWorkoutEditorDraft(
								editorDraft([editorOccurrence("reps_and_weight")], { mode }),
							),
						});
						yield* waitForEditor(answerPending);
						if (mode.kind === "live") {
							expect(screen.getByRole("button", { name: "Log measurement" })).toBeTruthy();
						} else {
							expect(screen.queryByRole("button", { name: "Log measurement" })).toBeNull();
						}
						page.dispose();
					}
				} finally {
					disposePluginBridges();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);
	it.live("recovers all exercise kinds with their numeric fields accessible", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const draft = editorDraft(exerciseKinds.map(({ kind }) => editorOccurrence(kind)));
				expect(draft.occurrences).toHaveLength(exerciseKinds.length);
				const { page, answerPending } = openEditor(clock, {
					value: encodeWorkoutEditorDraft(draft),
				});
				yield* waitForEditor(answerPending);

				for (const { kind, name } of exerciseKinds) {
					const exercise = screen.getByRole("region", { name });
					for (const [field, value] of Object.entries(defaultMeasurements[kind])) {
						let suffix = "";
						if (field === "weight") {
							suffix = " (kg)";
						} else if (field === "distance") {
							suffix = " (km)";
						} else if (field === "duration") {
							suffix = " (seconds)";
						}
						const input = within(exercise).getByRole("textbox", {
							name: `Set 1 ${field}${suffix}`,
						});
						expect(inputValue(input)).toBe(value);
					}
				}
				page.dispose();
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("saves the latest name and measurements after the finish review", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const set = editorSet("set-weight", "reps_and_weight", {
					included: true,
					occurredAt: startedAt,
					confirmedAt: startedAt,
				});
				const draft = editorDraft([editorOccurrence("reps_and_weight", [set])]);
				const { page, saveInputs, saveRequested, answerPending } = openEditor(clock, {
					value: encodeWorkoutEditorDraft(draft),
				});
				yield* waitForEditor(answerPending);

				click(screen.getByRole("button", { name: "Details" }));
				const details = screen.getByRole("dialog", { name: "Workout details" });
				const name = within(details).getByRole("textbox", { name: "Name" });
				change(name, "Latest workout name");
				expect(inputValue(name)).toBe("Latest workout name");
				click(within(details).getByRole("button", { name: "Done" }));
				yield* Effect.promise(() => waitFor(() => expect(details.isConnected).toBe(false)));
				const reps = screen.getByRole("textbox", { name: "Set 1 reps" });
				const weight = screen.getByRole("textbox", { name: "Set 1 weight (kg)" });
				change(reps, "9");
				change(weight, "22.5");
				expect(inputValue(reps)).toBe("9");
				expect(inputValue(weight)).toBe("22.5");

				click(screen.getByRole("button", { name: "Finish" }));
				const review = screen.getByRole("dialog", { name: "Finish workout?" });
				click(within(review).getByRole("button", { name: "Save workout" }));
				yield* saveRequested;
				expect(saveInputs).toHaveLength(1);

				expect(saveInputs[0]).toMatchObject({
					data: {
						kind: "workout",
						name: "Latest workout name",
						occurrences: [{ sets: [{ measurements: { reps: 9, weight: 22.5 } }] }],
					},
				});
				page.dispose();
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("reviews confirmed and unconfirmed sets without changing or discarding them", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const draft = editorDraft([
					editorOccurrence("reps_and_weight", [
						editorSet("confirmed-set", "reps_and_weight", {
							included: true,
							occurredAt: startedAt,
							confirmedAt: startedAt,
						}),
						editorSet("unconfirmed-set", "reps_and_weight"),
					]),
				]);
				const storage: EditorStorage = { value: encodeWorkoutEditorDraft(draft) };
				const { page, saveInputs, answerPending, storageActions } = openEditor(clock, storage);
				yield* waitForEditor(answerPending);

				click(screen.getByRole("button", { name: "Finish" }));
				const review = screen.getByRole("dialog", { name: "Finish workout?" });
				expect(review.textContent).toContain("Sets saved1");
				expect(review.textContent).toContain("1 unfinished set won't be saved");
				click(within(review).getByRole("button", { name: "Keep logging" }));

				expect(screen.queryByRole("dialog", { name: "Finish workout?" })).toBeNull();
				expect(screen.getByRole("button", { pressed: true, name: "Complete set 1" })).toBeTruthy();
				expect(screen.getByRole("button", { pressed: false, name: "Complete set 2" })).toBeTruthy();
				expect(saveInputs).toHaveLength(0);
				expect(storage.value).toBe(encodeWorkoutEditorDraft(draft));
				expect(storageActions).not.toContain("remove");
				page.dispose();
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("keeps historical event sets included without live clocks or device schedules", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const draft = editorDraft(
					[
						editorOccurrence("reps_and_weight", [
							editorSet("historical-set", "reps_and_weight", {
								included: true,
								occurredAt: startedAt,
								eventId: "legacy-event",
							}),
						]),
					],
					{
						activeDurationIntent: "preserve",
						mode: {
							kind: "historical",
							entityId: "workout-existing",
							conflictToken: "baseline-token",
						},
					},
				);
				const { page, saveInputs, answerPending, deviceRequests } = openEditor(clock, {
					value: encodeWorkoutEditorDraft(draft),
				});
				yield* waitForEditor(answerPending);

				expect(screen.queryByText("Workout active")).toBeNull();
				expect(screen.queryByRole("timer")).toBeNull();
				expect(screen.queryByRole("button", { name: "Start stopwatch" })).toBeNull();
				expect(deviceRequests.some(({ action }) => action === "schedule")).toBe(false);
				expect(
					deviceRequests.some(({ action, enabled }) => action === "awake" && enabled === true),
				).toBe(false);

				click(screen.getByRole("button", { name: "Save" }));
				const review = screen.getByRole("dialog", { name: "Save changes?" });
				expect(review.textContent).toContain("Included sets1");
				expect(review.textContent).toContain("Excluded0");
				click(within(review).getByRole("button", { name: "Save workout" }));
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(saveInputs).toHaveLength(1);
					}),
				);
				expect(saveInputs[0]).toMatchObject({
					data: {
						kind: "workout",
						occurrences: [{ sets: [{ eventId: "legacy-event" }] }],
						target: { kind: "update", entityId: "workout-existing" },
					},
				});
				expect(saveInputs[0]).not.toHaveProperty("data.occurrences.0.sets.0.confirmedAt");
				page.dispose();
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("saves exercise-only and partially specified template rows without confirmation", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const draft = editorDraft(
					[
						editorOccurrence("reps", [], "occurrence-exercise-only"),
						editorOccurrence(
							"reps_and_weight",
							[
								editorSet("partial-set", "reps_and_weight", { reps: "5", weight: undefined }),
								editorSet("empty-set", "reps_and_weight", { reps: undefined, weight: undefined }),
							],
							"occurrence-partial",
						),
					],
					{ activeDurationIntent: "preserve", mode: { kind: "template-create" } },
				);
				const { page, saveInputs, answerPending } = openEditor(clock, {
					value: encodeWorkoutEditorDraft(draft),
				});
				yield* waitForEditor(answerPending);

				expect(screen.queryByRole("button", { name: /^Complete set/ })).toBeNull();
				click(screen.getByRole("button", { name: "Save" }));
				const review = screen.getByRole("dialog", { name: "Save template?" });
				expect(review.textContent).toContain(
					"2 exercises and 2 planned sets. Partly filled sets are kept; completely empty set rows are dropped.",
				);
				click(within(review).getByRole("button", { name: "Save template" }));
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(saveInputs).toHaveLength(1);
					}),
				);

				expect(saveInputs[0]).toMatchObject({
					data: {
						kind: "template",
						occurrences: [
							{ sets: [], clientId: "occurrence-exercise-only" },
							{ clientId: "occurrence-partial", sets: [{ measurements: { reps: 5 } }] },
						],
					},
				});
				page.dispose();
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("marks missing values inline and copies the whole previous set", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const draft = editorDraft([
					editorOccurrence("reps_and_weight", [
						editorSet("empty-set", "reps_and_weight", { reps: undefined, weight: undefined }),
					]),
				]);
				const { page, answerPending } = openEditor(
					clock,
					{ value: encodeWorkoutEditorDraft(draft) },
					[],
					{},
					true,
					[previousWeightSet],
				);
				yield* waitForEditor(answerPending);
				const set = within(screen.getByRole("region", { name: "Weight exercise" })).getByRole(
					"group",
					{ name: "Set 1" },
				);

				click(within(set).getByRole("button", { name: "Complete set 1" }));
				expect(within(set).getByRole("alert").textContent).toBe(
					"Enter reps and weight to complete this set. Zero is allowed.",
				);
				expect(
					within(set)
						.getByRole("textbox", { name: "Set 1 weight (kg)" })
						.getAttribute("aria-invalid"),
				).toBe("true");
				expect(
					within(set).getByRole("button", { pressed: false, name: "Complete set 1" }),
				).toBeTruthy();

				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(
							within(set).getByRole("button", { name: "Set 1: copy previous 80 kg × 7" }),
						).toBeTruthy();
					}),
				);
				click(within(set).getByRole("button", { name: "Set 1: copy previous 80 kg × 7" }));
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(inputValue(within(set).getByRole("textbox", { name: "Set 1 reps" }))).toBe("7");
						expect(
							inputValue(within(set).getByRole("textbox", { name: "Set 1 weight (kg)" })),
						).toBe("80");
					}),
				);
				expect(within(set).queryByRole("alert")).toBeNull();
				page.dispose();
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live(
		"copies the displayed Previous values into the following set without changing a completed row",
		() =>
			Effect.gen(function* () {
				const clock = createTestRyotClock();
				try {
					yield* Effect.promise(() => clock.setTime(startedAtMillis));
					const draft = editorDraft([
						editorOccurrence("reps_and_weight", [
							editorSet("done", "reps_and_weight", { included: true, confirmedAt: startedAt }),
							editorSet("next", "reps_and_weight"),
						]),
					]);
					const { page, answerPending } = openEditor(
						clock,
						{ value: encodeWorkoutEditorDraft(draft) },
						[],
						{},
						true,
						[
							previousWeightSet,
							{
								...previousWeightSet,
								reps: 10,
								weight: 100,
								setOrder: 1,
								id: "other-previous-set",
							},
						],
					);
					yield* waitForEditor(answerPending);
					yield* Effect.promise(() =>
						waitFor(() => {
							answerPending();
							expect(
								screen.getByRole("button", { name: "Set 1: copy previous 80 kg × 7" }),
							).toBeTruthy();
						}),
					);
					click(screen.getByRole("button", { name: "Set 1: copy previous 80 kg × 7" }));
					yield* Effect.promise(() =>
						waitFor(() => {
							answerPending();
							expect(inputValue(screen.getByRole("textbox", { name: "Set 2 reps" }))).toBe("7");
							expect(inputValue(screen.getByRole("textbox", { name: "Set 2 weight (kg)" }))).toBe(
								"80",
							);
						}),
					);
					expect(inputValue(screen.getByRole("textbox", { name: "Set 1 weight (kg)" }))).toBe("20");
					expect(
						screen.getByRole("button", { pressed: true, name: "Complete set 1" }),
					).toBeTruthy();
					change(screen.getByRole("textbox", { name: "Set 1 reps" }), "");
					expect(
						screen.getByRole("button", { pressed: false, name: "Complete set 1" }),
					).toBeTruthy();
					page.dispose();
				} finally {
					disposePluginBridges();
					yield* Effect.promise(() => clock.dispose());
				}
			}),
	);

	it.live("asks before appending history and leaves the draft unchanged on cancellation", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const draft = editorDraft([editorOccurrence("reps_and_weight")]);
				const { page, answerPending } = openEditor(
					clock,
					{ value: encodeWorkoutEditorDraft(draft) },
					[],
					{},
					true,
					[previousWeightSet],
					[
						{
							comment: null,
							id: "previous-workout",
							name: "Earlier session",
							startedAt: "2026-10-10T10:00:00.000Z",
						},
					],
				);
				yield* waitForEditor(answerPending);
				click(
					within(screen.getByRole("region", { name: "Weight exercise" })).getByRole("button", {
						name: "History",
					}),
				);
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(screen.getByRole("button", { name: "Add sets" }).hasAttribute("disabled")).toBe(
							false,
						);
					}),
				);
				click(screen.getByRole("button", { name: "Add sets" }));
				const confirmation = screen.getByRole("dialog", { name: "Add sets from Earlier session?" });
				expect(confirmation.textContent).toContain("1 set from this session");
				click(within(confirmation).getByRole("button", { name: "Cancel" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(document.body.contains(confirmation)).toBe(false)),
				);
				click(
					within(screen.getByRole("dialog", { name: "History" })).getByRole("button", {
						name: "Close history",
					}),
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getAllByRole("group", { name: /^Set \d/ })).toHaveLength(1)),
				);
				click(
					within(screen.getByRole("region", { name: "Weight exercise" })).getByRole("button", {
						name: "Collapse Weight exercise",
					}),
				);
				click(
					within(screen.getByRole("region", { name: "Weight exercise" })).getByRole("button", {
						name: "History",
					}),
				);
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(screen.getByRole("button", { name: "Add sets" }).hasAttribute("disabled")).toBe(
							false,
						);
					}),
				);
				click(screen.getByRole("button", { name: "Add sets" }));
				click(
					within(screen.getByRole("dialog", { name: "Add sets from Earlier session?" })).getByRole(
						"button",
						{ name: "Add sets" },
					),
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getAllByRole("group", { name: /^Set \d/ })).toHaveLength(2)),
				);
				expect(inputValue(screen.getByRole("textbox", { name: "Set 2 weight (kg)" }))).toBe("80");
				page.dispose();
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("supports prompted rest start and skip for zero-valued set measurements", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const draft = editorDraft(
					[
						editorOccurrence("reps_and_weight", [
							editorSet("skip-rest-set", "reps_and_weight", { reps: "0", weight: "0" }),
							editorSet("start-rest-set", "reps_and_weight", { reps: "0", weight: "0" }),
						]),
					],
					{ localPreferences: { promptForRestTimer: true } },
				);
				const { page, answerPending } = openEditor(clock, {
					value: encodeWorkoutEditorDraft(draft),
				});
				yield* waitForEditor(answerPending);
				const exercise = screen.getByRole("region", { name: "Weight exercise" });
				const firstSet = within(exercise).getByRole("group", { name: "Set 1" });
				const secondSet = within(exercise).getByRole("group", { name: "Set 2" });

				click(within(firstSet).getByRole("button", { name: "Complete set 1" }));
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(screen.getByRole("status", { name: "Rest prompt" }).textContent).toContain(
							"Rest for 0:20?",
						);
					}),
				);
				click(screen.getByRole("button", { name: "Skip rest" }));
				expect(screen.queryByRole("status", { name: "Rest prompt" })).toBeNull();
				expect(screen.queryByRole("timer", { name: "Rest remaining" })).toBeNull();
				expect(
					within(exercise).getAllByRole("button", { pressed: true, name: /^Complete set/ }),
				).toHaveLength(1);

				click(within(secondSet).getByRole("button", { name: "Complete set 2" }));
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(screen.getByRole("status", { name: "Rest prompt" }).textContent).toContain(
							"Rest for 0:20?",
						);
					}),
				);
				click(screen.getByRole("button", { name: "Start rest" }));
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(screen.getByRole("timer", { name: "Rest remaining" })).toBeTruthy();
					}),
				);
				expect(
					within(exercise)
						.getByRole("button", { name: "Expand Weight exercise" })
						.getAttribute("aria-expanded"),
				).toBe("false");
				expect(within(exercise).getByText("2/2 done")).toBeTruthy();
				page.dispose();
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("converts units in place and uses bridge Back to close exercise sheets", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const draft = editorDraft([editorOccurrence("reps_and_weight")]);
				const { page, answerPending } = openEditor(clock, {
					value: encodeWorkoutEditorDraft(draft),
				});
				yield* waitForEditor(answerPending);
				click(screen.getByRole("button", { name: "Weight exercise actions" }));
				click(screen.getByRole("menuitem", { name: "Units and rest defaults" }));
				const defaults = screen.getByRole("dialog", { name: "Units and rest defaults" });
				click(within(defaults).getByRole("radio", { name: "Pounds" }));
				expect(inputValue(screen.getByRole("textbox", { name: "Set 1 weight (lb)" }))).toBe(
					"44.092452437",
				);

				dismissOverlay(page, "dismiss-defaults");
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(page.clientMessages()).toContainEqual(
							expect.objectContaining({
								dismissed: true,
								requestId: "dismiss-defaults",
								type: "dismiss-overlay-result",
							}),
						);
						expect(screen.queryByRole("dialog", { name: "Units and rest defaults" })).toBeNull();
					}),
				);

				const exercise = screen.getByRole("region", { name: "Weight exercise" });
				click(within(exercise).getByRole("button", { name: "Set 1, Normal. Set options" }));
				expect(screen.getByRole("dialog", { name: "Set 1" })).toBeTruthy();
				dismissOverlay(page, "dismiss-set");
				yield* Effect.promise(() =>
					waitFor(() => {
						answerPending();
						expect(page.clientMessages()).toContainEqual(
							expect.objectContaining({
								dismissed: true,
								requestId: "dismiss-set",
								type: "dismiss-overlay-result",
							}),
						);
						expect(screen.queryByRole("dialog", { name: "Set 1" })).toBeNull();
						expect(screen.getByRole("region", { name: "Weight exercise" })).toBeTruthy();
					}),
				);
				page.dispose();
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);

	it.live("recovers the latest name and measurement after the page reloads", () =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			try {
				yield* Effect.promise(() => clock.setTime(startedAtMillis));
				const draft = editorDraft([editorOccurrence("reps_and_weight")]);
				const storage: EditorStorage = { value: encodeWorkoutEditorDraft(draft) };
				const first = openEditor(clock, storage);
				yield* waitForEditor(first.answerPending);
				click(screen.getByRole("button", { name: "Details" }));
				change(screen.getByRole("textbox", { name: "Name" }), "Stored workout name");
				click(screen.getByRole("button", { name: "Done" }));
				change(screen.getByRole("textbox", { name: "Set 1 reps" }), "11");
				yield* Effect.promise(() =>
					waitFor(() => {
						first.answerPending();
						const stored = decodeWorkoutEditorDraft(storage.value);
						assert(stored._tag === "Success");
						expect(stored.success.name).toBe("Stored workout name");
						expect(stored.success.occurrences[0]?.sets[0]?.reps).toBe("11");
					}),
				);
				first.page.dispose();

				const recovered = openEditor(clock, storage);
				yield* Effect.promise(() =>
					waitFor(() => {
						recovered.answerPending();
						expect(
							screen.getByRole("heading", { level: 1, name: "Stored workout name" }),
						).toBeTruthy();
						expect(inputValue(screen.getByRole("textbox", { name: "Set 1 reps" }))).toBe("11");
					}),
				);
				recovered.page.dispose();
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
});
