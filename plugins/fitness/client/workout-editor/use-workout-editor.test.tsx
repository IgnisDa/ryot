import { expect, it } from "@effect/vitest";
import type { ClientPageContext } from "@ryot-app/plugin-client-contract";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	waitForMessagePortMacrotask,
} from "@ryot-app/plugin-client-sdk/testing";
import { Schema } from "@ryot-app/plugin-kit/effect";
import { screen, waitFor } from "@testing-library/dom";
import * as Deferred from "effect/Deferred";
import { act, useEffect, useRef, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { workoutEditorSaveOperationSlug } from "../../shared/workout-editor-context-operations";
import {
	decodeWorkoutEditorDraft,
	encodeWorkoutEditorDraft,
	WorkoutEditorDraftSchema,
} from "../../shared/workout-editor-draft";
import { WorkoutEditorSaveInputSchema } from "../../shared/workout-editor-operations";
import { liveDraft, preferenceSettings, startTime } from "../../tests/client/draft-fixtures";
import { useInitialDraft } from "./use-initial-draft";
import { useWorkoutEditor } from "./use-workout-editor";

function Probe() {
	const [renders, setRenders] = useState(0);
	const { snapshot } = useWorkoutEditor({
		search: "",
		path: "/editor",
		kind: "plugin-route",
		packageId: PLUGIN_PACKAGE_ID,
	});
	const second = useWorkoutEditor({
		search: "",
		path: "/editor",
		kind: "plugin-route",
		packageId: PLUGIN_PACKAGE_ID,
	});
	return (
		<PluginScreenFrame title="Editor probe">
			<p>{snapshot.status === "ready" ? snapshot.draft.name : snapshot.status}</p>
			<p>
				Second:{" "}
				{second.snapshot.status === "ready" ? second.snapshot.draft.name : second.snapshot.status}
			</p>
			<button
				onClick={() => second.controller.change((draft) => ({ ...draft, name: "Shared update" }))}
			>
				Share update
			</button>
			<button onClick={() => setRenders(renders + 1)}>Render {renders}</button>
		</PluginScreenFrame>
	);
}

it.live(
	"retains the controller across renders, refreshes context once, and requests awake demand",
	() =>
		Effect.gen(function* () {
			const clock = createTestRyotClock();
			const pluginId = PluginId.make("fitness");
			const context: ClientPageContext = {
				view: null,
				settings: {},
				dataSources: null,
				route: { params: {} },
				renderer: { pluginId, kind: "plugin", exportName: "probe" },
				target: { search: "", path: "/editor", kind: "plugin-route", packageId: PLUGIN_PACKAGE_ID },
				contributors: [
					pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID }),
				],
			};
			const initialDraft = yield* Schema.decodeEffect(WorkoutEditorDraftSchema)({
				images: [],
				videos: [],
				supersets: [],
				occurrences: [],
				activeDuration: 0,
				draftId: "draft-1",
				mode: { kind: "live" },
				name: "Recovered session",
				displayEnergyUnit: "kcal",
				activeDurationIntent: "set",
				kind: "fitness-workout-editor",
				startedAt: "2026-10-15T10:00:00.000Z",
			});
			const stored = encodeWorkoutEditorDraft(initialDraft);
			const page = mountPluginPage(Probe, {
				page: context,
				bootstrap: clock.bootstrap,
				location: routeLocation("/editor"),
			});
			const answered = new Set<string>();
			const respond = () => {
				for (const request of page.clientMessages()) {
					if (!("requestId" in request) || answered.has(request.requestId)) {
						continue;
					}
					answered.add(request.requestId);
					if (request.type === "storage-request") {
						page.send({
							outcome: "success",
							type: "storage-result",
							requestId: request.requestId,
							value: request.action === "get" ? stored : null,
						});
					} else if (request.type === "device-request") {
						page.send({
							outcome: "success",
							type: "device-result",
							value: { status: "done" },
							requestId: request.requestId,
						});
					} else if (request.type === "ios-live-activity-request") {
						page.send({
							outcome: "success",
							requestId: request.requestId,
							value: { status: "unsupported" },
							type: "ios-live-activity-result",
						});
					} else if (request.type === "operation-request") {
						page.send({
							outcome: "success",
							type: "operation-result",
							requestId: request.requestId,
							value: {
								proAvailable: false,
								settings: {
									dropRestTime: 0,
									warmUpRestTime: 0,
									muteSounds: false,
									normalRestTime: 60,
									failureRestTime: 0,
									energyUnit: "kcal",
									unitSystem: "metric",
									promptForRestTimer: false,
									startTimerForDurationExercises: true,
								},
							},
						});
					}
				}
			};
			try {
				yield* Effect.promise(() =>
					waitFor(() => {
						respond();
						expect(screen.getByText("Recovered session")).toBeTruthy();
						expect(page.clientMessages()).toContainEqual(
							expect.objectContaining({ enabled: true, action: "awake", type: "device-request" }),
						);
					}),
				);
				act(() => screen.getByRole("button", { name: "Render 0" }).click());
				expect(screen.getByRole("button", { name: "Render 1" })).toBeTruthy();
				expect(
					page
						.clientMessages()
						.filter((request) => request.type === "storage-request" && request.action === "get"),
				).toHaveLength(1);
				act(() => screen.getByRole("button", { name: "Share update" }).click());
				expect(screen.getByText("Shared update")).toBeTruthy();
				expect(screen.getByText("Second: Shared update")).toBeTruthy();
				page.send({ type: "page-refresh" });
				yield* waitForMessagePortMacrotask;
				yield* Effect.promise(() => clock.advance("1 second"));
				yield* Effect.promise(() =>
					waitFor(() => {
						respond();
						expect(
							page.clientMessages().filter((request) => request.type === "operation-request"),
						).toHaveLength(2);
					}),
				);
				yield* waitForMessagePortMacrotask;
				yield* Effect.promise(() => clock.advance("1 second"));
				expect(
					page.clientMessages().filter((request) => request.type === "operation-request"),
				).toHaveLength(2);
			} finally {
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
);

const saveProbeTarget = {
	search: "",
	path: "/editor",
	packageId: PLUGIN_PACKAGE_ID,
	kind: "plugin-route" as const,
};

const probeSubmission = Schema.decodeSync(WorkoutEditorSaveInputSchema)({
	submittedAt: startTime,
	submissionId: "submission-1",
	data: {
		images: [],
		videos: [],
		supersets: [],
		occurrences: [],
		name: "Session",
		kind: "workout",
		startedAt: startTime,
		target: { kind: "create" },
		activeDuration: { seconds: 0, kind: "set" },
	},
});

type Removal = "pending" | "failure" | "success";

type SaveStage = "cleanup" | "invocation" | "persistence";

function SaveProbe() {
	const [mounted, setMounted] = useState(true);
	const [nextEdit, setNextEdit] = useState(false);
	return (
		<PluginScreenFrame title="Save probe">
			<button onClick={() => setMounted(!mounted)}>Toggle consumers</button>
			<button onClick={() => setNextEdit(true)}>Open next edit</button>
			{nextEdit ? <PrepareConsumer /> : null}
			{mounted && !nextEdit ? (
				<>
					<SaveConsumer name="First" />
					<SaveConsumer name="Second" />
				</>
			) : null}
		</PluginScreenFrame>
	);
}

function PrepareConsumer() {
	const { saved, saving, snapshot, controller } = useWorkoutEditor(saveProbeTarget);
	const [message, setMessage] = useState<string>();
	const request = useInitialDraft({
		saving,
		message,
		setMessage,
		controller,
		isActive: true,
		onStarted: undefined,
		requiresPro: undefined,
		context: snapshot.context,
		snapshotStatus: snapshot.status,
		draft: snapshot.status === "ready" ? snapshot.draft : undefined,
		prepareDraft: () => Effect.succeed(liveDraft({ name: "Next edit", draftId: "next-edit" })),
	});
	return (
		<p>{`${snapshot.status === "ready" ? snapshot.draft.name : snapshot.status}, ${request.requestHandled ? "started" : "preparing"}, ${saved ?? "unsaved"}`}</p>
	);
}
function SaveConsumer({ name }: { readonly name: string }) {
	const { saved, saving, snapshot, controller } = useWorkoutEditor(saveProbeTarget);
	const schedule = useRyotSchedule();
	const cancelSave = useRef<undefined | (() => void)>(undefined);
	useEffect(() => () => cancelSave.current?.(), []);
	return (
		<>
			<p>{`${name}: ${snapshot.status}, ${saving ? "busy" : "idle"}, ${saved ?? "unsaved"}`}</p>
			<button
				onClick={() => {
					cancelSave.current = schedule.run(
						controller
							.save((current) => Effect.succeed({ draft: current.draft, input: probeSubmission }))
							.pipe(Effect.ignore),
						() => undefined,
					);
				}}
			>
				Save {name}
			</button>
			<button onClick={() => cancelSave.current?.()}>Interrupt {name}</button>
		</>
	);
}

const saveProbeHarness = (
	clock: ReturnType<typeof createTestRyotClock>,
	gate?: {
		readonly stage: SaveStage;
		readonly entered: Deferred.Deferred<void>;
		readonly release: Deferred.Deferred<void>;
	},
) => {
	const pluginId = PluginId.make("fitness");
	const page = mountPluginPage(SaveProbe, {
		bootstrap: clock.bootstrap,
		location: routeLocation("/editor"),
		page: {
			view: null,
			settings: {},
			dataSources: null,
			route: { params: {} },
			target: saveProbeTarget,
			renderer: { pluginId, kind: "plugin", exportName: "probe" },
			contributors: [
				pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID }),
			],
		},
	});
	let stored: null | string = encodeWorkoutEditorDraft(liveDraft());
	let removal: Removal = "pending";
	const answered = new Set<string>();
	const respond = () => {
		for (const request of page.clientMessages()) {
			if (!("requestId" in request) || answered.has(request.requestId)) {
				continue;
			}
			if (
				request.type === "storage-request" &&
				request.action === "remove" &&
				removal === "pending"
			) {
				continue;
			}
			answered.add(request.requestId);
			const reply = () => {
				if (request.type === "storage-request") {
					if (request.action === "remove" && removal === "failure") {
						page.send({
							reason: "quota",
							outcome: "failure",
							type: "storage-result",
							requestId: request.requestId,
						});
						return;
					}
					if (request.action === "set") {
						stored = typeof request.value === "string" ? request.value : null;
					} else if (request.action === "remove") {
						stored = null;
					}
					page.send({
						outcome: "success",
						type: "storage-result",
						requestId: request.requestId,
						value: request.action === "get" ? stored : null,
					});
				} else if (request.type === "operation-request") {
					page.send({
						outcome: "success",
						type: "operation-result",
						requestId: request.requestId,
						value:
							request.operationSlug === workoutEditorSaveOperationSlug
								? { sets: [], kind: "saved", entityId: "saved-workout" }
								: { proAvailable: true, settings: preferenceSettings },
					});
				} else if (request.type === "device-request") {
					page.send({
						outcome: "success",
						type: "device-result",
						value: { status: "done" },
						requestId: request.requestId,
					});
				} else if (request.type === "ios-live-activity-request") {
					page.send({
						outcome: "success",
						requestId: request.requestId,
						value: { status: "unsupported" },
						type: "ios-live-activity-result",
					});
				}
			};
			let stage: SaveStage | undefined;
			if (request.type === "storage-request" && request.action === "set") {
				stage = "persistence";
			} else if (
				request.type === "operation-request" &&
				request.operationSlug === workoutEditorSaveOperationSlug
			) {
				stage = "invocation";
			} else if (request.type === "storage-request" && request.action === "remove") {
				stage = "cleanup";
			}
			if (gate !== undefined && gate.stage === stage) {
				clock.runtime.runFork(
					Deferred.succeed(gate.entered, undefined).pipe(
						Effect.andThen(Deferred.await(gate.release)),
						Effect.andThen(Effect.sync(reply)),
					),
				);
			} else {
				reply();
			}
		}
	};
	return {
		page,
		respond,
		get stored() {
			return stored;
		},
		setRemoval: (next: Removal) => {
			removal = next;
		},
	};
};

it.live("shares acknowledgement and busy state through cleanup failure and consumer remount", () =>
	Effect.gen(function* () {
		const clock = createTestRyotClock();
		const { page, respond, setRemoval } = saveProbeHarness(clock);
		try {
			yield* Effect.promise(() =>
				waitFor(() => {
					respond();
					expect(screen.getByText("First: ready, idle, unsaved")).toBeTruthy();
					expect(screen.getByText("Second: ready, idle, unsaved")).toBeTruthy();
				}),
			);
			act(() => screen.getByRole("button", { name: "Save First" }).click());
			yield* Effect.promise(() =>
				waitFor(() => {
					respond();
					expect(screen.getByText("First: ready, busy, saved-workout")).toBeTruthy();
					expect(screen.getByText("Second: ready, busy, saved-workout")).toBeTruthy();
				}),
			);
			act(() => screen.getByRole("button", { name: "Save Second" }).click());
			setRemoval("failure");
			yield* Effect.promise(() =>
				waitFor(() => {
					respond();
					expect(screen.getByText("First: ready, idle, saved-workout")).toBeTruthy();
					expect(screen.getByText("Second: ready, idle, saved-workout")).toBeTruthy();
				}),
			);
			act(() => screen.getByRole("button", { name: "Toggle consumers" }).click());
			act(() => screen.getByRole("button", { name: "Toggle consumers" }).click());
			yield* Effect.promise(() =>
				waitFor(() => {
					respond();
					expect(screen.getByText("First: ready, idle, saved-workout")).toBeTruthy();
					expect(screen.getByText("Second: ready, idle, saved-workout")).toBeTruthy();
				}),
			);
			setRemoval("pending");
			act(() => screen.getByRole("button", { name: "Save Second" }).click());
			yield* Effect.promise(() =>
				waitFor(() => {
					respond();
					expect(screen.getByText("First: ready, busy, saved-workout")).toBeTruthy();
					expect(screen.getByText("Second: ready, busy, saved-workout")).toBeTruthy();
				}),
			);
			setRemoval("success");
			yield* Effect.promise(() =>
				waitFor(() => {
					respond();
					expect(screen.getByText("First: empty, idle, saved-workout")).toBeTruthy();
					expect(screen.getByText("Second: empty, idle, saved-workout")).toBeTruthy();
				}),
			);
			expect(
				page
					.clientMessages()
					.filter(
						(request) =>
							request.type === "operation-request" &&
							request.operationSlug === workoutEditorSaveOperationSlug,
					),
			).toHaveLength(1);
			expect(
				page
					.clientMessages()
					.filter((request) => request.type === "storage-request" && request.action === "remove"),
			).toHaveLength(2);
			expect(
				page
					.clientMessages()
					.filter((request) => request.type === "storage-request" && request.action === "get"),
			).toHaveLength(1);
		} finally {
			disposePluginBridges();
			yield* Effect.promise(() => clock.dispose());
		}
	}),
);

for (const stage of ["persistence", "invocation", "cleanup"] as const) {
	it.live(`keeps an interrupted save active across all-consumer teardown during ${stage}`, () =>
		Effect.gen(function* () {
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const clock = createTestRyotClock();
			const harness = saveProbeHarness(clock, { stage, entered, release });
			const { page, respond } = harness;
			harness.setRemoval("success");
			try {
				yield* Effect.promise(() =>
					waitFor(() => {
						respond();
						expect(screen.getByText("First: ready, idle, unsaved")).toBeTruthy();
						expect(screen.getByText("Second: ready, idle, unsaved")).toBeTruthy();
					}),
				);
				act(() => screen.getByRole("button", { name: "Save First" }).click());
				yield* Effect.promise(() =>
					waitFor(() => {
						respond();
						expect(clock.runtime.runSync(Deferred.isDone(entered))).toBe(true);
					}),
				);
				yield* Deferred.await(entered);
				const acknowledged = stage === "cleanup" ? "saved-workout" : "unsaved";
				expect(screen.getByText(`First: ready, busy, ${acknowledged}`)).toBeTruthy();
				expect(screen.getByText(`Second: ready, busy, ${acknowledged}`)).toBeTruthy();
				act(() => screen.getByRole("button", { name: "Interrupt First" }).click());
				act(() => screen.getByRole("button", { name: "Toggle consumers" }).click());
				expect(screen.queryByRole("button", { name: "Save First" })).toBeNull();
				expect(screen.queryByRole("button", { name: "Save Second" })).toBeNull();
				yield* waitForMessagePortMacrotask;
				act(() => screen.getByRole("button", { name: "Toggle consumers" }).click());
				yield* Effect.promise(() =>
					waitFor(() => {
						respond();
						expect(screen.getByText(`First: ready, busy, ${acknowledged}`)).toBeTruthy();
						expect(screen.getByText(`Second: ready, busy, ${acknowledged}`)).toBeTruthy();
					}),
				);
				act(() => screen.getByRole("button", { name: "Save Second" }).click());
				act(() => screen.getByRole("button", { name: "Toggle consumers" }).click());
				expect(screen.queryByRole("button", { name: "Save First" })).toBeNull();
				expect(screen.queryByRole("button", { name: "Save Second" })).toBeNull();
				yield* Deferred.succeed(release, undefined);
				yield* Effect.promise(() =>
					waitFor(() => {
						respond();
						expect(harness.stored).toBeNull();
					}),
				);
				act(() => screen.getByRole("button", { name: "Toggle consumers" }).click());
				yield* Effect.promise(() =>
					waitFor(() => {
						respond();
						expect(screen.getByText("First: empty, idle, saved-workout")).toBeTruthy();
						expect(screen.getByText("Second: empty, idle, saved-workout")).toBeTruthy();
					}),
				);
				expect(harness.stored).toBeNull();
				expect(
					page
						.clientMessages()
						.filter(
							(request) =>
								request.type === "operation-request" &&
								request.operationSlug === workoutEditorSaveOperationSlug,
						),
				).toHaveLength(1);
				expect(
					page
						.clientMessages()
						.filter((request) => request.type === "storage-request" && request.action === "remove"),
				).toHaveLength(1);
				expect(
					page
						.clientMessages()
						.filter((request) => request.type === "storage-request" && request.action === "get"),
				).toHaveLength(1);
			} finally {
				yield* Deferred.succeed(release, undefined);
				disposePluginBridges();
				yield* Effect.promise(() => clock.dispose());
			}
		}),
	);
}

it.live("starts a fresh editor request after the shared controller has completed a save", () =>
	Effect.gen(function* () {
		const clock = createTestRyotClock();
		const harness = saveProbeHarness(clock);
		harness.setRemoval("success");
		try {
			yield* Effect.promise(() =>
				waitFor(() => {
					harness.respond();
					expect(screen.getByText("First: ready, idle, unsaved")).toBeTruthy();
				}),
			);
			act(() => screen.getByRole("button", { name: "Save First" }).click());
			yield* Effect.promise(() =>
				waitFor(() => {
					harness.respond();
					expect(screen.getByText("First: empty, idle, saved-workout")).toBeTruthy();
				}),
			);
			act(() => screen.getByRole("button", { name: "Open next edit" }).click());
			yield* Effect.promise(() =>
				waitFor(() => {
					harness.respond();
					expect(screen.getByText("Next edit, started, unsaved")).toBeTruthy();
				}),
			);
			const stored = decodeWorkoutEditorDraft(harness.stored);
			expect(stored._tag).toBe("Success");
			if (stored._tag === "Success") {
				expect(stored.success.draftId).toBe("next-edit");
				expect(stored.success.submission).toBeUndefined();
			}
		} finally {
			disposePluginBridges();
			yield* Effect.promise(() => clock.dispose());
		}
	}),
);
