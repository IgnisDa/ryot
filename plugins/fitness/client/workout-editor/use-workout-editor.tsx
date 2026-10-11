import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	usePageRefresh,
	usePluginScreenSurface,
	type PluginNavigationTarget,
} from "@ryot-app/plugin-client-sdk/plugin";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import {
	WorkoutEditorContextOutputSchema,
	workoutEditorContextOperationSlug,
} from "../../shared/workout-editor-context-operations";
import { createWorkoutEditorController } from "./controller";

const DRAFT_STORAGE_KEY = "fitness-workout-editor-draft";

export const useWorkoutEditor = (target: PluginNavigationTarget) => {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const { isActive } = usePluginScreenSurface();
	const [resumeTarget] = useState(target);
	const pluginId = client.pluginIdentity(PLUGIN_PACKAGE_ID).pluginId;
	const controller = useMemo(
		() =>
			createWorkoutEditorController({
				pluginId,
				schedule,
				target: resumeTarget,
				now: Effect.sync(() => schedule.now()),
				device: (request) => client.device(request),
				storage: {
					read: client.storage.get(pluginId, DRAFT_STORAGE_KEY),
					remove: client.storage.remove(pluginId, DRAFT_STORAGE_KEY),
					write: (value) => client.storage.set(pluginId, DRAFT_STORAGE_KEY, value),
				},
				refreshContext: client.operations.invoke({
					input: {},
					refreshOnSuccess: false,
					packageId: PLUGIN_PACKAGE_ID,
					slug: workoutEditorContextOperationSlug,
					output: WorkoutEditorContextOutputSchema,
				}),
			}),
		[client, pluginId, schedule, resumeTarget],
	);
	const snapshot = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot,
	);
	usePageRefresh(() => controller.reconcile().pipe(Effect.ignore));
	const awake =
		isActive &&
		snapshot.status === "ready" &&
		snapshot.draft.mode.kind === "live" &&
		snapshot.draft.endedAt === undefined &&
		snapshot.draft.submission === undefined;
	useEffect(() => {
		const cancel = schedule.run(
			client
				.device({ pluginId, enabled: awake, action: "awake" })
				.pipe(Effect.ignore, Effect.asVoid),
			() => undefined,
		);
		return () => {
			cancel();
			schedule.run(
				client
					.device({ pluginId, enabled: false, action: "awake" })
					.pipe(Effect.ignore, Effect.asVoid),
				() => undefined,
			);
		};
	}, [awake, client, pluginId, schedule]);
	useEffect(() => {
		const unregisterFlush = client.persistence.registerFlush(() =>
			controller
				.flush()
				.pipe(
					Effect.mapError((error) =>
						error instanceof RyotClientError ? error : new RyotClientError("transport"),
					),
				),
		);
		const cancelLoad = schedule.run(controller.load().pipe(Effect.ignore), () => undefined);
		return () => {
			cancelLoad();
			controller.dispose();
			unregisterFlush();
		};
	}, [client, controller, schedule]);
	return { snapshot, controller };
};
