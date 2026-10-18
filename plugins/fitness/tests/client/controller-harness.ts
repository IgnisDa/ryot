import { type ManagedAssetLocator, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	type PluginDeviceRequest,
	type PluginDeviceResult,
	PluginId,
	type PluginNavigationTarget,
	PluginPackageId,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { RyotSchedule } from "@ryot-app/plugin-client-sdk/schedule";

import { createWorkoutEditorController } from "../../client/workout-editor/controller";
import type { WorkoutEditorControllerPorts } from "../../client/workout-editor/controller-types";
import { preferenceSettings, startTime } from "./draft-fixtures";

const noopSchedule: Pick<RyotSchedule, "run" | "after"> = {
	run: () => () => undefined,
	after: () => () => undefined,
};

const unsupportedIosActivity = () => Effect.succeed({ status: "unsupported" } as const);

const defaultTarget: PluginNavigationTarget = {
	search: "",
	path: "/workout",
	kind: "plugin-route",
	packageId: PluginPackageId.make("ryot/fitness"),
};

export const controllerHarness = (
	options: {
		readonly pro?: boolean;
		readonly stored?: unknown;
		readonly events?: string[];
		readonly pluginId?: PluginId;
		readonly onRemove?: () => void;
		readonly cleanupFails?: boolean;
		readonly onRead?: () => unknown;
		readonly foreground?: () => boolean;
		readonly target?: PluginNavigationTarget;
		readonly now?: Effect.Effect<number, unknown>;
		readonly remove?: Effect.Effect<void, unknown>;
		readonly save?: WorkoutEditorControllerPorts["save"];
		readonly schedule?: Pick<RyotSchedule, "run" | "after">;
		readonly onWrite?: (value: string) => Effect.Effect<void, unknown>;
		readonly upload?: () => Effect.Effect<ManagedAssetLocator, RyotClientError>;
		readonly iosLiveActivities?: WorkoutEditorControllerPorts["iosLiveActivities"];
		readonly device?: (request: PluginDeviceRequest) => Effect.Effect<PluginDeviceResult>;
	} = {},
) => {
	let stored: unknown = options.stored ?? null;
	let reads = 0;
	let removals = 0;
	const writes: string[] = [];
	const cleaned: ManagedAssetLocator[] = [];
	const submissions: Parameters<WorkoutEditorControllerPorts["save"]>[0][] = [];
	const controller = createWorkoutEditorController({
		feedback: () => Effect.void,
		target: options.target ?? defaultTarget,
		schedule: options.schedule ?? noopSchedule,
		foreground: options.foreground ?? (() => true),
		now: options.now ?? Effect.succeed(Date.parse(startTime)),
		pluginId: options.pluginId ?? PluginId.make("fitness-installation"),
		device: options.device ?? (() => Effect.succeed({ status: "done" })),
		upload: options.upload ?? (() => Effect.fail(new RyotClientError("unsupported-capability"))),
		refreshContext: Effect.succeed({
			settings: preferenceSettings,
			proAvailable: options.pro ?? true,
		}),
		save: (input) =>
			Effect.gen(function* () {
				submissions.push(input);
				return yield* options.save?.(input) ?? Effect.fail("save unavailable");
			}),
		iosLiveActivities: options.iosLiveActivities ?? {
			end: unsupportedIosActivity,
			list: unsupportedIosActivity,
			start: unsupportedIosActivity,
			update: unsupportedIosActivity,
			availability: unsupportedIosActivity,
		},
		cleanup: (locator) =>
			Effect.sync(() => {
				cleaned.push(locator);
			}).pipe(
				Effect.flatMap(() =>
					options.cleanupFails
						? Effect.fail(new RyotClientError("transport"))
						: Effect.succeed({ status: "deleted" as const }),
				),
			),
		storage: {
			read: Effect.sync(() => {
				reads += 1;
				return options.onRead?.() ?? stored;
			}),
			remove: Effect.gen(function* () {
				removals += 1;
				if (options.remove !== undefined) {
					yield* options.remove;
				}
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
		cleaned,
		controller,
		submissions,
		read: () => stored,
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
