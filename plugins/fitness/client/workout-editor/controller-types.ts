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

export type WorkoutEditorContext = typeof WorkoutEditorContextOutputSchema.Type;
export type TimerName = "execution" | "rest";

type SavedResult = Extract<WorkoutEditorSaveOutput, { readonly kind: "saved" }>;

type SaveState =
	| { readonly phase: "idle" }
	| { readonly phase: "in-flight" }
	| {
			readonly phase: "acknowledged";
			readonly result: SavedResult;
			readonly cleaning: boolean;
	  }
	| { readonly phase: "saved"; readonly result: SavedResult };

type ContextSnapshot = {
	readonly context: WorkoutEditorContext | undefined;
	readonly contextError: unknown;
	readonly saveState: SaveState;
};

export const isWorkoutEditorSaving = (snapshot: WorkoutEditorControllerSnapshot) =>
	snapshot.saveState.phase === "in-flight" ||
	(snapshot.saveState.phase === "acknowledged" && snapshot.saveState.cleaning);

export type WorkoutEditorControllerSnapshot =
	| (ContextSnapshot & { readonly status: "loading" })
	| (ContextSnapshot & { readonly status: "empty" })
	| (ContextSnapshot & {
			readonly error: unknown;
			readonly rawValue: unknown;
			readonly status: "recovery-error";
	  })
	| (ContextSnapshot & {
			readonly alertStatus: Readonly<Partial<Record<TimerName, PluginDeviceResult["status"]>>>;
			readonly deviceError: unknown;
			readonly dirty: boolean;
			readonly draft: WorkoutEditorDraft;
			readonly persistenceError: unknown;
			readonly uploading: boolean;
			readonly uploadError?: unknown;
			readonly status: "ready";
			readonly timerError: unknown;
	  });

export type ReadySnapshot = Extract<WorkoutEditorControllerSnapshot, { readonly status: "ready" }>;

export type WorkoutEditorControllerPorts = {
	readonly iosLiveActivities: RyotClient["iosLiveActivities"];
	readonly pluginId: PluginId;
	readonly target: PluginNavigationTarget;
	readonly foreground: () => boolean;
	readonly now: Effect.Effect<number, unknown>;
	readonly feedback: () => Effect.Effect<void>;
	readonly cleanup: RyotClient["uploads"]["cleanup"];
	readonly save: (input: WorkoutEditorSaveInput) => Effect.Effect<WorkoutEditorSaveOutput, unknown>;
	readonly upload: RyotClient["uploads"]["uploadPermanent"];
	readonly refreshContext: Effect.Effect<WorkoutEditorContext, unknown>;
	readonly schedule: Pick<RyotSchedule, "after" | "run">;
	readonly device: (request: PluginDeviceRequest) => Effect.Effect<PluginDeviceResult, unknown>;
	readonly storage: {
		readonly read: Effect.Effect<unknown, unknown>;
		readonly remove: Effect.Effect<void, unknown>;
		readonly write: (value: string) => Effect.Effect<void, unknown>;
	};
};
