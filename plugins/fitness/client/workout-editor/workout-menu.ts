import type { Text } from "@ryot-app/plugin-client-sdk/react";
import { formatClock, type MenuItem } from "@ryot-app/plugin-ui-sdk";

import type { FitnessText } from "../messages";
import type { EditorOverlay } from "./editor-overlays";

export const workoutMenuItems = (input: {
	readonly live: boolean;
	readonly locked: boolean;
	readonly text: FitnessText;
	readonly template: boolean;
	readonly stopwatch: number;
	readonly discardLabel: Text;
	readonly attachments: number;
	readonly discardBlocked: boolean;
	readonly stopwatchRunning: boolean;
	readonly onResetStopwatch: () => void;
	readonly onLogMeasurement: () => void;
	readonly onToggleStopwatch: () => void;
	readonly onOpenWorkoutMedia: () => void;
	readonly measurementUnavailable: boolean;
	readonly onOverlay: (overlay: EditorOverlay) => void;
}): MenuItem[] => [
	{
		key: "details",
		onSelect: () => input.onOverlay("details"),
		label: input.template
			? input.text("client.wsheets.template-details")
			: input.text("client.wsheets.workout-details"),
	},
	...(input.live
		? [
				{
					key: "measurement",
					onSelect: input.onLogMeasurement,
					label: input.text("client.measurements.log"),
					disabled: input.locked || input.measurementUnavailable,
				},
			]
		: []),
	{
		key: "attachments",
		onSelect: input.onOpenWorkoutMedia,
		label: input.text("client.editor.attachments-count", { count: input.attachments }),
	},
	{
		key: "reorder",
		label: input.text("client.reorder.title"),
		onSelect: () => input.onOverlay("reorder"),
	},
	{
		key: "supersets",
		label: input.text("property.supersets"),
		onSelect: () => input.onOverlay("supersets"),
	},
	{
		key: "bulk-delete",
		label: input.text("client.editor.delete-sets"),
		onSelect: () => input.onOverlay("bulk-delete"),
	},
	...(input.live
		? [
				{
					key: "stopwatch",
					disabled: input.locked,
					onSelect: input.onToggleStopwatch,
					label: input.text("client.timers.stopwatch-menu", {
						time: formatClock(input.stopwatch),
						action: input.stopwatchRunning ? "pause" : "start",
					}),
				},
				...(input.stopwatch > 0 && !input.stopwatchRunning
					? [
							{
								disabled: input.locked,
								key: "reset-stopwatch",
								onSelect: input.onResetStopwatch,
								label: input.text("client.timers.reset-stopwatch"),
							},
						]
					: []),
				{
					key: "preferences",
					label: input.text("client.editor.preferences"),
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
