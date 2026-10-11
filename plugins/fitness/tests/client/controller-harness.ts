import { RyotClientError, type ManagedAssetLocator } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	PluginId,
	PluginPackageId,
	type PluginDeviceRequest,
	type PluginDeviceResult,
	type PluginNavigationTarget,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { RyotSchedule } from "@ryot-app/plugin-client-sdk/schedule";

import { createWorkoutEditorController } from "../../client/workout-editor/controller";
import { preferenceSettings, startTime } from "./draft-fixtures";

const noopSchedule: Pick<RyotSchedule, "after" | "run"> = {
	run: () => () => undefined,
	after: () => () => undefined,
};

const defaultTarget: PluginNavigationTarget = {
	search: "",
	path: "/workout",
	kind: "plugin-route",
	packageId: PluginPackageId.make("ryot/fitness"),
};

export const controllerHarness = (
	options: {
		readonly stored?: unknown;
		readonly pro?: boolean;
		readonly events?: string[];
		readonly cleanupFails?: boolean;
		readonly foreground?: () => boolean;
		readonly onRead?: () => unknown;
		readonly onRemove?: () => void;
		readonly pluginId?: PluginId;
		readonly schedule?: Pick<RyotSchedule, "after" | "run">;
		readonly target?: PluginNavigationTarget;
		readonly now?: Effect.Effect<number, unknown>;
		readonly device?: (request: PluginDeviceRequest) => Effect.Effect<PluginDeviceResult>;
		readonly onWrite?: (value: string) => Effect.Effect<void, unknown>;
		readonly upload?: () => Effect.Effect<ManagedAssetLocator, RyotClientError>;
	} = {},
) => {
	let stored: unknown = options.stored ?? null;
	let reads = 0;
	let removals = 0;
	const writes: string[] = [];
	const cleaned: ManagedAssetLocator[] = [];
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
		cleaned,
		controller,
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
