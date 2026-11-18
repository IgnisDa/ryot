import { type RyotClient, RyotClientError, type RyotSchedule } from "@ryot-app/plugin-client-sdk";
import { Effect, Semaphore } from "@ryot-app/plugin-client-sdk/effect";
import {
	type PluginNavigationTarget,
	usePageRefresh,
	usePluginScreenSurface,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	type Formatters,
	useFormatters,
	useRyot,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { workoutEditorSaveOperationSlug } from "../../shared/workout-editor-context-operations";
import {
	WorkoutEditorSaveInputSchema,
	WorkoutEditorSaveOutputSchema,
} from "../../shared/workout-editor-operations";
import { type FitnessText, useFitnessMessages } from "../messages";
import { invokeWorkoutEditorContext } from "./context-query";
import { createWorkoutEditorController } from "./controller";
import { isWorkoutEditorSaving, type WorkoutEditorSaveResult } from "./controller-types";
import { DRAFT_STORAGE_KEY } from "./draft-storage";
import { createWorkoutEditorSounds } from "./sounds";

const noop = () => {};

const createEditorSession = (
	formatters: Formatters,
	text: FitnessText,
	client: RyotClient,
	schedule: RyotSchedule,
	target: PluginNavigationTarget,
) => {
	const pluginId = client.pluginIdentity(PLUGIN_PACKAGE_ID).pluginId;
	const screens = new Map<symbol, boolean>();
	const awakeSemaphore = Semaphore.makeUnsafe(1);
	let awakeRequested: boolean | undefined;
	let players = createWorkoutEditorSounds();
	let unregisterFlush = noop;
	let unsubscribe = noop;
	let cancelLoad = noop;
	let releaseAudio = noop;
	let reconciling = false;
	const feedback = (): Effect.Effect<void> =>
		Effect.gen(function* () {
			if (document.visibilityState !== "visible" || ![...screens.values()].some(Boolean)) {
				return;
			}
			const current = controller.getSnapshot();
			const muted =
				current.status === "ready" &&
				(current.draft.localPreferences?.muteSounds ??
					current.context?.settings.muteSounds ??
					false);
			yield* players.play("timer-completed", muted);
			yield* client.device({ kind: "impact", action: "haptic" }).pipe(Effect.ignore);
		});
	const controller = createWorkoutEditorController(formatters, {
		text,
		target,
		pluginId,
		schedule,
		feedback,
		now: Effect.sync(() => schedule.now()),
		iosLiveActivities: client.iosLiveActivities,
		device: (request) => client.device(request),
		refreshContext: invokeWorkoutEditorContext(client),
		foreground: () => document.visibilityState === "visible",
		upload: (request) => client.uploads.uploadPermanent(request),
		storage: {
			read: client.storage.get(pluginId, DRAFT_STORAGE_KEY),
			remove: client.storage.remove(pluginId, DRAFT_STORAGE_KEY),
			write: (value) => client.storage.set(pluginId, DRAFT_STORAGE_KEY, value),
		},
		save: (submission) =>
			client.operations
				.invoke({
					input: submission,
					refreshOnSuccess: false,
					packageId: PLUGIN_PACKAGE_ID,
					submittedAt: submission.submittedAt,
					slug: workoutEditorSaveOperationSlug,
					output: WorkoutEditorSaveOutputSchema,
					idempotencyKey: submission.submissionId,
					inputSchema: WorkoutEditorSaveInputSchema,
				})
				.pipe(
					Effect.flatMap(
						({ output, committed }): Effect.Effect<WorkoutEditorSaveResult, RyotClientError> => {
							if (output.kind === "invalid") {
								return Effect.succeed(output);
							}
							return committed.entityId === undefined
								? Effect.fail(new RyotClientError({ reason: "malformed-result" }))
								: Effect.succeed({ kind: "saved", entityId: committed.entityId });
						},
					),
					Effect.catchIf(
						(error) => error.reason === "changes-conflict",
						() => Effect.succeed({ kind: "conflict" } as const),
					),
					Effect.tap((result) =>
						Effect.sync(() => {
							if (result.kind === "saved") {
								client.mutationCompleted.hint();
							}
						}),
					),
				),
	});
	const synchronizeAwake = () =>
		schedule.run(
			awakeSemaphore
				.withPermit(
					Effect.gen(function* () {
						const snapshot = controller.getSnapshot();
						const awake =
							[...screens.values()].some(Boolean) &&
							snapshot.status === "ready" &&
							snapshot.draft.mode.kind === "live" &&
							snapshot.draft.endedAt === undefined &&
							snapshot.draft.submission === undefined;
						if (awake === awakeRequested) {
							return;
						}
						yield* client.device({ pluginId, enabled: awake, action: "awake" });
						awakeRequested = awake;
					}),
				)
				.pipe(Effect.ignore),
			() => undefined,
		);
	return {
		controller,
		activate: (key: symbol, active: boolean) => {
			screens.set(key, active);
			synchronizeAwake();
		},
		sounds: {
			play: (...args: Parameters<ReturnType<typeof createWorkoutEditorSounds>["play"]>) =>
				Effect.suspend(() => players.play(...args)),
		},
		reconcile: () =>
			Effect.gen(function* () {
				if (reconciling) {
					return;
				}
				reconciling = true;
				yield* controller.reconcile().pipe(
					Effect.ensuring(
						Effect.sync(() => {
							reconciling = false;
						}),
					),
				);
			}),
		acquire: (key: symbol) => {
			if (screens.size === 0) {
				players = createWorkoutEditorSounds();
				const resumeAudio = () => {
					if (document.visibilityState === "visible") {
						schedule.run(players.resume, noop);
					}
				};
				document.addEventListener("pointerdown", resumeAudio, true);
				document.addEventListener("visibilitychange", resumeAudio);
				window.addEventListener("focus", resumeAudio);
				releaseAudio = () => {
					document.removeEventListener("pointerdown", resumeAudio, true);
					document.removeEventListener("visibilitychange", resumeAudio);
					window.removeEventListener("focus", resumeAudio);
				};
				unregisterFlush = client.persistence.registerFlush(() =>
					controller
						.flush()
						.pipe(
							Effect.mapError((error) =>
								error instanceof RyotClientError
									? error
									: new RyotClientError({ reason: "transport" }),
							),
						),
				);
				unsubscribe = controller.subscribe(synchronizeAwake);
				cancelLoad = schedule.run(controller.load().pipe(Effect.ignore), () => undefined);
			}
			screens.set(key, false);
			return () => {
				screens.delete(key);
				synchronizeAwake();
				if (screens.size === 0) {
					cancelLoad();
					unsubscribe();
					unregisterFlush();
					controller.dispose();
					releaseAudio();
					schedule.run(players.dispose(), noop);
				}
			};
		},
	};
};

const sessions = new WeakMap<RyotClient, ReturnType<typeof createEditorSession>>();

export const useWorkoutEditor = (target: PluginNavigationTarget) => {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const client = useRyot();
	const schedule = useRyotSchedule();
	const { isActive } = usePluginScreenSurface();
	const [resumeTarget] = useState(target);
	const [key] = useState(() => Symbol("workout-editor-screen"));
	const session = useMemo(() => {
		const existing = sessions.get(client);
		if (existing !== undefined) {
			return existing;
		}
		const created = createEditorSession(formatters, text, client, schedule, resumeTarget);
		sessions.set(client, created);
		return created;
	}, [client, formatters, resumeTarget, schedule, text]);
	const snapshot = useSyncExternalStore(
		session.controller.subscribe,
		session.controller.getSnapshot,
		session.controller.getSnapshot,
	);
	usePageRefresh(() => session.reconcile().pipe(Effect.ignore));
	useEffect(() => session.acquire(key), [key, session]);
	useEffect(() => session.activate(key, isActive), [isActive, key, session]);
	return {
		snapshot,
		sounds: session.sounds,
		controller: session.controller,
		saving: isWorkoutEditorSaving(snapshot),
		saved:
			snapshot.saveState.phase === "acknowledged" || snapshot.saveState.phase === "saved"
				? snapshot.saveState.result.entityId
				: undefined,
	};
};
