import { useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, Card, IconButton, ProgressBar } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
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

type Countdown = NonNullable<WorkoutEditorDraft["restCountdown"]>;
type CountdownKey = "executionCountdown" | "restCountdown";
type DraftChange = (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => void;

type NextSet = { readonly setId: string; readonly name: string; readonly number: number };

export const formatEditorSeconds = (seconds: number) => {
	const whole = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const rest = String(whole % 60).padStart(2, "0");
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
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

export const activeDurationSeconds = (draft: WorkoutEditorDraft, now: number) =>
	draft.activeDuration === undefined
		? undefined
		: draft.activeDuration +
			(draft.activeDurationStartedAt === undefined
				? 0
				: Math.max(0, (now - Date.parse(draft.activeDurationStartedAt)) / 1000));

export const stopwatchSeconds = (draft: WorkoutEditorDraft, now: number) =>
	(draft.pausedStopwatchSeconds ?? 0) +
	(draft.stopwatchStartedAt === undefined
		? 0
		: Math.max(0, (now - Date.parse(draft.stopwatchStartedAt)) / 1000));

const remainingSeconds = (countdown: Countdown, now: number) =>
	Math.max(0, countdown.pausedRemainingSeconds ?? (Date.parse(countdown.deadline) - now) / 1000);

export const shiftCountdown = (
	draft: WorkoutEditorDraft,
	key: CountdownKey,
	clientId: string,
	seconds: number,
	now: number,
): WorkoutEditorDraft => {
	const current = draft[key];
	if (current === undefined || current.clientId !== clientId) {
		return draft;
	}
	return {
		...draft,
		[key]: {
			...current,
			deadline: new Date(
				Math.max(now, Date.parse(current.deadline) + seconds * 1000),
			).toISOString(),
			...(current.pausedRemainingSeconds === undefined
				? {}
				: { pausedRemainingSeconds: Math.max(0, current.pausedRemainingSeconds + seconds) }),
		},
	};
};

const timeClass = (dock: boolean) =>
	clsx("font-semibold tabular-nums", dock ? "text-[26px] leading-[30px]" : "text-timer");

function CountdownBlock(props: {
	readonly now: number;
	readonly dock: boolean;
	readonly disabled: boolean;
	readonly kind: CountdownKey;
	readonly countdown: Countdown;
	readonly heading: string;
	readonly onChange: DraftChange;
	readonly onFinish: () => void;
}) {
	const schedule = useRyotSchedule();
	const { onChange, countdown } = props;
	const rest = props.kind === "restCountdown";
	const paused = countdown.pausedRemainingSeconds !== undefined;
	const remaining = remainingSeconds(countdown, props.now);
	const total = Math.max(countdown.durationSeconds, remaining);
	const subject = rest ? "rest" : "set timer";
	const toggle = () =>
		onChange(
			(draft) =>
				(rest
					? (paused ? resumeRest : pauseRest)(draft, schedule.now(), countdown.clientId)
					: (paused ? resumeExecution : pauseExecution)(draft, schedule.now(), countdown.clientId)
				).draft,
		);
	const shift = (seconds: number) =>
		onChange((draft) =>
			shiftCountdown(draft, props.kind, countdown.clientId, seconds, schedule.now()),
		);
	const skip = () => onChange((draft) => ({ ...draft, [props.kind]: undefined }));
	return (
		<div className="grid gap-2">
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1">
					<p
						className={clsx(
							"truncate text-xs font-semibold",
							rest ? "text-accent-text" : "text-info",
						)}
					>
						{props.heading}
					</p>
					<p className={timeClass(props.dock)}>
						<span role="timer" aria-label={rest ? "Rest remaining" : "Execution remaining"}>
							{formatEditorSeconds(remaining)}
						</span>
						<span className="text-sm font-medium text-text-subtle">
							{" "}
							/ {formatEditorSeconds(total)}
						</span>
					</p>
				</div>
				{props.dock ? (
					<IconButton
						tone="filled"
						onClick={toggle}
						disabled={props.disabled}
						label={`${paused ? "Resume" : "Pause"} ${subject}`}
					>
						<AppIcon size={18} name={paused ? "play" : "pause"} />
					</IconButton>
				) : null}
				{props.dock && !rest ? (
					<Button onClick={props.onFinish} disabled={props.disabled}>
						Done
					</Button>
				) : null}
			</div>
			<ProgressBar
				max={total}
				value={total - remaining}
				tone={rest ? "accent" : "info"}
				label={rest ? "Rest progress" : "Set timer progress"}
			/>
			<div className={clsx("flex flex-wrap items-center gap-1.5", props.dock && "*:flex-1")}>
				{props.dock ? null : (
					<Button size="sm" onClick={toggle} variant="secondary" disabled={props.disabled}>
						<AppIcon size={14} name={paused ? "play" : "pause"} />
						{paused ? "Resume" : "Pause"}
					</Button>
				)}
				{rest ? (
					<Button
						size="sm"
						variant="secondary"
						disabled={props.disabled}
						onClick={() => shift(-15)}
						aria-label="Subtract 15 seconds"
					>
						−15s
					</Button>
				) : null}
				<Button
					size="sm"
					variant="secondary"
					onClick={() => shift(15)}
					disabled={props.disabled}
					aria-label="Add 15 seconds"
				>
					+15s
				</Button>
				<Button size="sm" onClick={skip} variant="ghost" disabled={props.disabled}>
					{rest ? "Skip rest" : "Skip timer"}
				</Button>
				{!props.dock && !rest ? (
					<Button size="sm" className="ml-auto" onClick={props.onFinish} disabled={props.disabled}>
						Done now
					</Button>
				) : null}
			</div>
		</div>
	);
}

function StopwatchControls(props: {
	readonly now: number;
	readonly disabled: boolean;
	readonly draft: WorkoutEditorDraft;
	readonly onChange: DraftChange;
}) {
	const schedule = useRyotSchedule();
	const running = props.draft.stopwatchStartedAt !== undefined;
	const seconds = stopwatchSeconds(props.draft, props.now);
	return (
		<div className="flex items-center gap-2">
			<div className="min-w-0 flex-1">
				<p className="text-[11px] font-semibold tracking-wider text-text-subtle uppercase">
					Stopwatch
				</p>
				<p role="timer" aria-label="Stopwatch" className="text-xl font-semibold tabular-nums">
					{formatEditorSeconds(seconds)}
				</p>
			</div>
			<IconButton
				tone="filled"
				disabled={props.disabled}
				label={running ? "Pause stopwatch" : "Start stopwatch"}
				onClick={() =>
					props.onChange(
						(draft) =>
							(draft.stopwatchStartedAt === undefined
								? resumeStopwatch(draft, schedule.now())
								: pauseStopwatch(draft, schedule.now())
							).draft,
					)
				}
			>
				<AppIcon size={18} name={running ? "pause" : "play"} />
			</IconButton>
			<Button
				size="sm"
				variant="ghost"
				disabled={props.disabled || seconds === 0}
				onClick={() => props.onChange((draft) => resetStopwatch(draft).draft)}
			>
				Reset stopwatch
			</Button>
		</div>
	);
}

function PendingRestPrompt(props: {
	readonly seconds: number;
	readonly disabled: boolean;
	readonly onStartRest: () => void;
	readonly onSkipRest: () => void;
}) {
	return (
		<div role="status" aria-label="Rest prompt" className="flex flex-wrap items-center gap-2">
			<div className="min-w-0 flex-1">
				<p className="text-xs font-semibold text-success">Set completed</p>
				<p className="text-base font-semibold">Rest for {formatEditorSeconds(props.seconds)}?</p>
			</div>
			<Button variant="ghost" disabled={props.disabled} onClick={props.onSkipRest}>
				Skip rest
			</Button>
			<Button disabled={props.disabled} onClick={props.onStartRest}>
				Start rest
			</Button>
		</div>
	);
}

type TimerProps = {
	readonly now: number;
	readonly disabled: boolean;
	readonly draft: WorkoutEditorDraft;
	readonly nextSet: NextSet | undefined;
	readonly names: ReadonlyMap<string, string>;
	readonly onChange: DraftChange;
	readonly onFinishExecution: () => void;
	readonly onStartRest: () => void;
	readonly onSkipRest: () => void;
};

const activeTimer = (props: TimerProps, dock: boolean) => {
	const { draft } = props;
	if (draft.executionCountdown !== undefined) {
		const countdown = draft.executionCountdown;
		return (
			<CountdownBlock
				dock={dock}
				now={props.now}
				countdown={countdown}
				kind="executionCountdown"
				disabled={props.disabled}
				onChange={props.onChange}
				onFinish={props.onFinishExecution}
				heading={`${countdown.pausedRemainingSeconds === undefined ? "Working" : "Paused"} · ${props.names.get(countdown.exerciseId) ?? "Exercise"}`}
			/>
		);
	}
	if (draft.pendingRest !== undefined) {
		return (
			<PendingRestPrompt
				disabled={props.disabled}
				onSkipRest={props.onSkipRest}
				onStartRest={props.onStartRest}
				seconds={draft.pendingRest.seconds}
			/>
		);
	}
	if (draft.restCountdown !== undefined) {
		const countdown = draft.restCountdown;
		return (
			<CountdownBlock
				dock={dock}
				now={props.now}
				kind="restCountdown"
				countdown={countdown}
				disabled={props.disabled}
				onChange={props.onChange}
				onFinish={props.onFinishExecution}
				heading={`${countdown.pausedRemainingSeconds === undefined ? "Resting" : "Rest paused"}${props.nextSet === undefined ? "" : ` · next ${props.nextSet.name}`}`}
			/>
		);
	}
	return undefined;
};

export function DockTimers(
	props: TimerProps & {
		readonly onJumpToSet: (setId: string) => void;
		readonly onAddExercises: () => void;
	},
) {
	const schedule = useRyotSchedule();
	const active = activeTimer(props, true);
	if (active !== undefined) {
		return active;
	}
	const running = props.draft.stopwatchStartedAt !== undefined;
	const stopwatch = stopwatchSeconds(props.draft, props.now);
	return (
		<div className="flex items-center gap-2">
			{running || stopwatch > 0 ? (
				<button
					type="button"
					disabled={props.disabled}
					aria-label={`${running ? "Pause" : "Resume"} stopwatch ${formatEditorSeconds(stopwatch)}`}
					className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill border border-border-emphasis bg-surface px-3 text-[13px] font-medium tabular-nums pointer-coarse:h-10"
					onClick={() =>
						props.onChange(
							(draft) =>
								(draft.stopwatchStartedAt === undefined
									? resumeStopwatch(draft, schedule.now())
									: pauseStopwatch(draft, schedule.now())
								).draft,
						)
					}
				>
					<AppIcon size={14} name={running ? "pause" : "timer"} />
					{formatEditorSeconds(stopwatch)}
				</button>
			) : null}
			{props.nextSet === undefined ? (
				<p className="min-w-0 flex-1 text-sm font-semibold">All sets done</p>
			) : (
				<button
					type="button"
					className="min-w-0 flex-1 py-0.5 text-left"
					onClick={() => {
						if (props.nextSet !== undefined) {
							props.onJumpToSet(props.nextSet.setId);
						}
					}}
				>
					<span className="block text-xs text-text-muted">Up next</span>
					<span className="block truncate text-sm font-semibold">
						{props.nextSet.name} · set {props.nextSet.number}
					</span>
				</button>
			)}
			<Button variant="secondary" disabled={props.disabled} onClick={props.onAddExercises}>
				<AppIcon size={16} name="plus" />
				Exercise
			</Button>
		</div>
	);
}

export function RailTimers(props: TimerProps & { readonly startedAt: string | undefined }) {
	const schedule = useRyotSchedule();
	const { draft } = props;
	const paused = draft.activeDurationStartedAt === undefined;
	const active = activeTimer(props, false);
	return (
		<>
			<Card className="grid gap-2.5 p-3.5">
				<div className="flex items-center gap-2">
					<Badge dot variant={paused ? "warning" : "success"}>
						{paused ? "Paused" : "Active"}
					</Badge>
					<span className="flex-1" />
					{props.startedAt === undefined ? null : (
						<span className="text-xs text-text-muted">Started {props.startedAt}</span>
					)}
				</div>
				<p
					role="timer"
					aria-label="Active duration"
					className="text-timer font-semibold tabular-nums"
				>
					{formatEditorSeconds(activeDurationSeconds(draft, props.now) ?? 0)}
				</p>
				<Button
					size="sm"
					variant="secondary"
					disabled={props.disabled}
					onClick={() =>
						props.onChange(
							(current) =>
								(current.activeDurationStartedAt === undefined
									? resumeWorkout(current, schedule.now())
									: pauseWorkout(current, schedule.now())
								).draft,
						)
					}
				>
					<AppIcon size={14} name={paused ? "play" : "pause"} />
					{paused ? "Resume workout" : "Pause workout"}
				</Button>
			</Card>
			<Card className="p-3.5">
				{active ?? (
					<StopwatchControls
						draft={draft}
						now={props.now}
						disabled={props.disabled}
						onChange={props.onChange}
					/>
				)}
			</Card>
			{active === undefined ? null : (
				<Card className="p-3.5">
					<StopwatchControls
						draft={draft}
						now={props.now}
						disabled={props.disabled}
						onChange={props.onChange}
					/>
				</Card>
			)}
		</>
	);
}
