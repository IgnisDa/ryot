import type { MenuItem } from "@ryot-app/plugin-ui-sdk";

import { formatEditorSeconds } from "./clock";
import type { EditorOverlay } from "./editor-overlays";

export const workoutMenuItems = (input: {
	readonly live: boolean;
	readonly locked: boolean;
	readonly template: boolean;
	readonly stopwatch: number;
	readonly attachments: number;
	readonly discardLabel: string;
	readonly discardBlocked: boolean;
	readonly stopwatchRunning: boolean;
	readonly measurementUnavailable: boolean;
	readonly onResetStopwatch: () => void;
	readonly onToggleStopwatch: () => void;
	readonly onLogMeasurement: () => void;
	readonly onOpenWorkoutMedia: () => void;
	readonly onOverlay: (overlay: EditorOverlay) => void;
}): MenuItem[] => [
	{
		key: "details",
		onSelect: () => input.onOverlay("details"),
		label: input.template ? "Template details" : "Workout details",
	},
	...(input.live
		? [
				{
					key: "measurement",
					label: "Log measurement",
					onSelect: input.onLogMeasurement,
					disabled: input.locked || input.measurementUnavailable,
				},
			]
		: []),
	{
		key: "attachments",
		onSelect: input.onOpenWorkoutMedia,
		label: `Attachments (${input.attachments})`,
	},
	{ key: "reorder", label: "Reorder exercises", onSelect: () => input.onOverlay("reorder") },
	{ key: "supersets", label: "Supersets", onSelect: () => input.onOverlay("supersets") },
	{
		key: "bulk-delete",
		label: "Delete exercises or sets",
		onSelect: () => input.onOverlay("bulk-delete"),
	},
	...(input.live
		? [
				{
					key: "stopwatch",
					disabled: input.locked,
					onSelect: input.onToggleStopwatch,
					label: `${input.stopwatchRunning ? "Pause" : "Start"} stopwatch (${formatEditorSeconds(input.stopwatch)})`,
				},
				...(input.stopwatch > 0 && !input.stopwatchRunning
					? [
							{
								disabled: input.locked,
								key: "reset-stopwatch",
								label: "Reset stopwatch",
								onSelect: input.onResetStopwatch,
							},
						]
					: []),
				{
					key: "preferences",
					label: "Workout preferences",
					onSelect: () => input.onOverlay("preferences"),
				},
			]
		: []),
	{
		key: "discard",
		destructive: true,
		label: input.discardLabel,
		disabled: input.discardBlocked,
		onSelect: () => input.onOverlay("discard"),
	},
];
