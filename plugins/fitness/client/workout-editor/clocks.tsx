import { useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useState } from "react";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import {
	pauseExecution,
	pauseRest,
	pauseStopwatch,
	pauseWorkout,
	resetStopwatch,
	resumeExecution,
	resumeRest,
	resumeStopwatch,
	resumeWorkout,
} from "./timers";

export const formatEditorSeconds = (seconds: number) => {
	const whole = Math.max(0, Math.floor(seconds));
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

export const useEditorNow = (running: boolean) => {
	const schedule = useRyotSchedule();
	const [now, setNow] = useState(() => schedule.now());
	useEffect(() => {
		if (!running) {
			return undefined;
		}
		let cancel = () => {};
		const tick = () => {
			setNow(schedule.now());
			cancel = schedule.after(1000, tick);
		};
		tick();
		return () => cancel();
	}, [running, schedule]);
	return now;
};

export function EditorClocks(props: {
	readonly now: number;
	readonly draft: WorkoutEditorDraft;
	readonly disabled: boolean;
	readonly onChange: (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => void;
}) {
	const { now, onChange, draft: editorDraft } = props;
	const schedule = useRyotSchedule();
	if (editorDraft.mode.kind !== "live" || editorDraft.endedAt !== undefined) {
		return null;
	}
	const stopwatch =
		(editorDraft.pausedStopwatchSeconds ?? 0) +
		(editorDraft.stopwatchStartedAt === undefined
			? 0
			: Math.max(0, (now - Date.parse(editorDraft.stopwatchStartedAt)) / 1000));
	return (
		<div className="flex flex-col gap-3 rounded-xl border border-border p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span>
					{editorDraft.activeDurationStartedAt === undefined ? "Workout paused" : "Workout active"}
				</span>
				<Button
					variant="secondary"
					disabled={props.disabled}
					onClick={() =>
						onChange(
							(draft) =>
								(draft.activeDurationStartedAt === undefined
									? resumeWorkout(draft, schedule.now())
									: pauseWorkout(draft, schedule.now())
								).draft,
						)
					}
				>
					{editorDraft.activeDurationStartedAt === undefined ? "Resume workout" : "Pause workout"}
				</Button>
			</div>
			{(["executionCountdown", "restCountdown"] as const).map((key) => {
				const countdown = editorDraft[key];
				if (countdown === undefined) {
					return null;
				}
				const paused = countdown.pausedRemainingSeconds !== undefined;
				const rest = key === "restCountdown";
				const pause = rest ? pauseRest : pauseExecution;
				const resume = rest ? resumeRest : resumeExecution;
				const transition = paused ? resume : pause;
				return (
					<div key={key} className="flex flex-wrap items-center gap-2">
						<span role="timer" aria-label={rest ? "Rest remaining" : "Execution remaining"}>
							{rest ? "Rest" : "Execution"}:{" "}
							{formatEditorSeconds(
								countdown.pausedRemainingSeconds ?? (Date.parse(countdown.deadline) - now) / 1000,
							)}
						</span>
						<Button
							variant="secondary"
							disabled={props.disabled}
							onClick={() =>
								onChange((draft) => transition(draft, schedule.now(), countdown.clientId).draft)
							}
						>
							{paused ? "Resume" : "Pause"} {rest ? "rest" : "execution"}
						</Button>
						<Button
							variant="secondary"
							disabled={props.disabled}
							onClick={() =>
								onChange((draft) => {
									const current = draft[key];
									return current === undefined || current.clientId !== countdown.clientId
										? draft
										: {
												...draft,
												[key]: {
													...current,
													deadline: new Date(Date.parse(current.deadline) + 30000).toISOString(),
													...(current.pausedRemainingSeconds === undefined
														? {}
														: { pausedRemainingSeconds: current.pausedRemainingSeconds + 30 }),
												},
											};
								})
							}
						>
							+30 seconds
						</Button>
						<Button
							variant="ghost"
							disabled={props.disabled}
							onClick={() => onChange((draft) => ({ ...draft, [key]: undefined }))}
						>
							Skip {rest ? "rest" : "execution"}
						</Button>
					</div>
				);
			})}
			<div className="flex flex-wrap items-center gap-2">
				<span role="timer" aria-label="Stopwatch">
					Stopwatch: {formatEditorSeconds(stopwatch)}
				</span>
				<Button
					variant="secondary"
					disabled={props.disabled}
					onClick={() =>
						onChange(
							(draft) =>
								(draft.stopwatchStartedAt === undefined
									? resumeStopwatch(draft, schedule.now())
									: pauseStopwatch(draft, schedule.now())
								).draft,
						)
					}
				>
					{editorDraft.stopwatchStartedAt === undefined ? "Start stopwatch" : "Pause stopwatch"}
				</Button>
				<Button
					variant="ghost"
					disabled={props.disabled}
					onClick={() => onChange((draft) => resetStopwatch(draft).draft)}
				>
					Reset stopwatch
				</Button>
			</div>
		</div>
	);
}
