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

export type WorkoutEditorContext = typeof WorkoutEditorContextOutputSchema.Type;
export type TimerName = "execution" | "rest";

type ContextSnapshot = {
	readonly context: WorkoutEditorContext | undefined;
	readonly contextError: unknown;
};

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
			readonly saving: boolean;
			readonly uploading: boolean;
			readonly uploadError?: unknown;
			readonly status: "ready";
			readonly timerError: unknown;
	  });

export type ReadySnapshot = Extract<WorkoutEditorControllerSnapshot, { readonly status: "ready" }>;

export type WorkoutEditorControllerPorts = {
	readonly pluginId: PluginId;
	readonly target: PluginNavigationTarget;
	readonly foreground: () => boolean;
	readonly now: Effect.Effect<number, unknown>;
	readonly feedback: () => Effect.Effect<void>;
	readonly cleanup: RyotClient["uploads"]["cleanup"];
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
