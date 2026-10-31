import type { RyotClient, RyotSchedule } from "@ryot-app/plugin-client-sdk";
import type { Effect } from "@ryot-app/plugin-client-sdk/effect";
import type {
	PluginDeviceRequest,
	PluginDeviceResult,
	PluginId,
	PluginNavigationTarget,
} from "@ryot-app/plugin-client-sdk/plugin";

import type { WorkoutEditorContextOutputSchema } from "../../shared/workout-editor-context-operations";
import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type {
	WorkoutEditorSaveInput,
	WorkoutEditorSaveOutput,
} from "../../shared/workout-editor-operations";

export type TimerName = "rest" | "execution";
export type WorkoutEditorContext = typeof WorkoutEditorContextOutputSchema.Type;

type SavedResult = Extract<WorkoutEditorSaveOutput, { readonly kind: "saved" }>;

type ContextSnapshot = {
	readonly saveState: SaveState;
	readonly contextError: unknown;
	readonly context: undefined | WorkoutEditorContext;
};

type SaveState =
	| { readonly phase: "idle" }
	| { readonly phase: "in-flight" }
	| { readonly phase: "saved"; readonly result: SavedResult }
	| { readonly cleaning: boolean; readonly result: SavedResult; readonly phase: "acknowledged" };

export const isWorkoutEditorSaving = (snapshot: WorkoutEditorControllerSnapshot) =>
	snapshot.saveState.phase === "in-flight" ||
	(snapshot.saveState.phase === "acknowledged" && snapshot.saveState.cleaning);

export type ReadySnapshot = Extract<WorkoutEditorControllerSnapshot, { readonly status: "ready" }>;

export type WorkoutEditorControllerSnapshot =
	| (ContextSnapshot & { readonly status: "empty" })
	| (ContextSnapshot & { readonly status: "loading" })
	| (ContextSnapshot & {
			readonly error: unknown;
			readonly rawValue: unknown;
			readonly status: "recovery-error";
	  })
	| (ContextSnapshot & {
			readonly dirty: boolean;
			readonly status: "ready";
			readonly uploading: boolean;
			readonly timerError: unknown;
			readonly deviceError: unknown;
			readonly uploadError?: unknown;
			readonly draft: WorkoutEditorDraft;
			readonly persistenceError: unknown;
			readonly alertStatus: Readonly<Partial<Record<TimerName, PluginDeviceResult["status"]>>>;
	  });

export type WorkoutEditorControllerPorts = {
	readonly pluginId: PluginId;
	readonly foreground: () => boolean;
	readonly target: PluginNavigationTarget;
	readonly now: Effect.Effect<number, unknown>;
	readonly feedback: () => Effect.Effect<void>;
	readonly schedule: Pick<RyotSchedule, "run" | "after">;
	readonly upload: RyotClient["uploads"]["uploadPermanent"];
	readonly iosLiveActivities: RyotClient["iosLiveActivities"];
	readonly refreshContext: Effect.Effect<WorkoutEditorContext, unknown>;
	readonly device: (request: PluginDeviceRequest) => Effect.Effect<PluginDeviceResult, unknown>;
	readonly save: (input: WorkoutEditorSaveInput) => Effect.Effect<WorkoutEditorSaveOutput, unknown>;
	readonly storage: {
		readonly remove: Effect.Effect<void, unknown>;
		readonly read: Effect.Effect<unknown, unknown>;
		readonly write: (value: string) => Effect.Effect<void, unknown>;
	};
};
