import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { IosLiveActivityContent } from "@ryot-app/plugin-client-sdk/plugin";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type { WorkoutEditorControllerPorts } from "./controller-types";
import {
	savedWorkoutIosActivityContent,
	workoutIosActivityContent,
	workoutIosActivityKey,
} from "./ios-live-activity";

const maximumActivityMillis = 8 * 60 * 60 * 1000;

export const createWorkoutIosActivitySynchronizer = (
	ports: Pick<WorkoutEditorControllerPorts, "iosLiveActivities" | "pluginId" | "now">,
) => {
	let lastPublished: string | undefined;
	let lastKey: string | undefined;
	let unavailable = false;
	const synchronize = Effect.fnUntraced(function* (
		draft: WorkoutEditorDraft | undefined,
		names: ReadonlyMap<string, string>,
		imperial = false,
	) {
		if (unavailable) {
			return;
		}
		const api = ports.iosLiveActivities;
		const { pluginId } = ports;
		const live = draft?.mode.kind === "live" ? draft : undefined;
		const key = live === undefined ? undefined : workoutIosActivityKey(live);
		const content =
			live === undefined ? undefined : workoutIosActivityContent(live, names, imperial);
		const serialized =
			content === undefined
				? undefined
				: yield* Schema.encodeEffect(Schema.fromJsonString(IosLiveActivityContent))(content);
		if (key !== undefined && key === lastKey && serialized === lastPublished) {
			return;
		}
		const listed = yield* api.list({ pluginId });
		if (listed.status === "unsupported") {
			unavailable = true;
			return;
		}
		for (const entry of listed.activities) {
			if (entry.key !== key && (entry.state === "active" || entry.state === "stale")) {
				yield* api.end({ pluginId, key: entry.key });
			}
		}
		if (live === undefined || key === undefined || content === undefined) {
			lastPublished = undefined;
			return;
		}
		const previous = listed.activities.find((entry) => entry.key === key);
		if (previous?.state === "ended" || previous?.state === "dismissed") {
			return;
		}
		if (previous === undefined) {
			const now = yield* ports.now;
			if (
				live.startedAt === undefined ||
				now - Date.parse(live.startedAt) >= maximumActivityMillis ||
				live.endedAt !== undefined ||
				live.submission !== undefined
			) {
				return;
			}
		}
		const request = { key, content, pluginId };
		const result = yield* previous === undefined ? api.start(request) : api.update(request);
		if (result.status === "active") {
			lastPublished = serialized;
			lastKey = key;
		}
	});
	const finish = Effect.fnUntraced(function* (
		draft: WorkoutEditorDraft | undefined,
		names: ReadonlyMap<string, string>,
		saved: boolean,
		imperial = false,
	) {
		lastPublished = undefined;
		if (draft?.mode.kind !== "live" || unavailable) {
			return;
		}
		yield* ports.iosLiveActivities.end({
			pluginId: ports.pluginId,
			dismissalSeconds: saved ? 30 : 0,
			key: workoutIosActivityKey(draft),
			content: saved ? savedWorkoutIosActivityContent(draft, names, imperial) : undefined,
		});
	});
	return {
		finish: (...args: Parameters<typeof finish>) => finish(...args).pipe(Effect.ignore),
		synchronize: (...args: Parameters<typeof synchronize>) =>
			synchronize(...args).pipe(Effect.ignore),
	};
};

export const createWorkoutIosActivityPublisher = (
	ports: Pick<WorkoutEditorControllerPorts, "iosLiveActivities" | "pluginId" | "now" | "schedule">,
) => {
	const synchronizer = createWorkoutIosActivitySynchronizer(ports);
	const pending: { readonly effect: Effect.Effect<void>; readonly coalesce: boolean }[] = [];
	let running = false;
	const drain = Effect.fnUntraced(function* () {
		for (;;) {
			const next = pending.shift();
			if (next === undefined) {
				return;
			}
			yield* next.effect;
		}
	});
	const start = () => {
		if (running || pending.length === 0) {
			return;
		}
		running = true;
		ports.schedule.run(
			drain().pipe(
				Effect.onInterrupt(() =>
					Effect.sync(() => {
						pending.length = 0;
					}),
				),
			),
			() => {
				running = false;
				start();
			},
		);
	};
	const enqueue = (effect: Effect.Effect<void>, coalesce: boolean) => {
		if (coalesce && pending.at(-1)?.coalesce) {
			pending.pop();
		}
		pending.push({ effect, coalesce });
		start();
	};
	return {
		finish: (...args: Parameters<typeof synchronizer.finish>) =>
			enqueue(synchronizer.finish(...args), false),
		synchronize: (...args: Parameters<typeof synchronizer.synchronize>) =>
			enqueue(synchronizer.synchronize(...args), true),
	};
};
