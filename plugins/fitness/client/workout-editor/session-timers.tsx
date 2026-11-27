import { useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import {
	Badge,
	Button,
	Card,
	formatClock,
	IconButton,
	MotionSwap,
	ProgressBar,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useEffect, useState } from "react";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { type FitnessText, useFitnessMessages } from "../messages";
import type { DraftChange } from "./draft-ops";
import {
	activeDurationSeconds,
	pauseCountdown,
	remainingSeconds,
	resetStopwatch,
	resumeCountdown,
	shiftCountdown,
	stopwatchSeconds,
	toggleStopwatch,
	toggleWorkoutPause,
} from "./timers";

type CountdownKey = "restCountdown" | "executionCountdown";
type Countdown = NonNullable<WorkoutEditorDraft["restCountdown"]>;

type NextSet = { readonly name: string; readonly setId: string; readonly number: number };

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

const timeClass = (dock: boolean) =>
	clsx("font-semibold tabular-nums", dock ? "text-[26px] leading-[30px]" : "text-timer");

type TimerProps = {
	readonly now: number;
	readonly disabled: boolean;
	readonly onChange: DraftChange;
	readonly onSkipRest: () => void;
	readonly onStartRest: () => void;
	readonly draft: WorkoutEditorDraft;
	readonly nextSet: NextSet | undefined;
	readonly onFinishExecution: () => void;
	readonly names: ReadonlyMap<string, string>;
};

function PendingRestPrompt(props: {
	readonly seconds: number;
	readonly disabled: boolean;
	readonly onSkipRest: () => void;
	readonly onStartRest: () => void;
}) {
	const text = useFitnessMessages();
	return (
		<div
			role="status"
			className="flex flex-wrap items-center gap-2"
			aria-label={text("client.timers.rest-prompt")}
		>
			<div className="min-w-0 flex-1">
				<p className="text-xs font-semibold text-success">{text("client.timers.set-completed")}</p>
				<p className="text-base font-semibold">
					{text("client.timers.rest-for", { time: formatClock(props.seconds) })}
				</p>
			</div>
			<Button variant="ghost" disabled={props.disabled} onClick={props.onSkipRest}>
				{text("client.timers.skip-rest")}
			</Button>
			<Button disabled={props.disabled} onClick={props.onStartRest}>
				{text("client.timers.start-rest")}
			</Button>
		</div>
	);
}

function StopwatchControls(props: {
	readonly now: number;
	readonly disabled: boolean;
	readonly onChange: DraftChange;
	readonly draft: WorkoutEditorDraft;
}) {
	const text = useFitnessMessages();
	const schedule = useRyotSchedule();
	const running = props.draft.stopwatchStartedAt !== undefined;
	const seconds = stopwatchSeconds(props.draft, props.now);
	return (
		<div className="flex items-center gap-2">
			<div className="min-w-0 flex-1">
				<p className="text-[11px] font-semibold tracking-wider text-text-subtle uppercase">
					{text("client.timers.stopwatch")}
				</p>
				<p
					role="timer"
					aria-label={text("client.timers.stopwatch")}
					className="text-xl font-semibold tabular-nums"
				>
					{formatClock(seconds)}
				</p>
			</div>
			<IconButton
				tone="filled"
				disabled={props.disabled}
				onClick={() => props.onChange((draft) => toggleStopwatch(draft, schedule.now()).draft)}
				label={
					running ? text("client.timers.pause-stopwatch") : text("client.timers.start-stopwatch")
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
				{text("client.timers.reset-stopwatch")}
			</Button>
		</div>
	);
}

function CountdownBlock(props: {
	readonly now: number;
	readonly dock: boolean;
	readonly heading: string;
	readonly disabled: boolean;
	readonly kind: CountdownKey;
	readonly countdown: Countdown;
	readonly onFinish: () => void;
	readonly onChange: DraftChange;
}) {
	const text = useFitnessMessages();
	const schedule = useRyotSchedule();
	const { onChange, countdown } = props;
	const rest = props.kind === "restCountdown";
	const paused = countdown.pausedRemainingSeconds !== undefined;
	const remaining = remainingSeconds(countdown, props.now);
	const total = Math.max(countdown.durationSeconds, remaining);
	const toggle = () =>
		onChange(
			(draft) =>
				(paused ? resumeCountdown : pauseCountdown)(
					draft,
					props.kind,
					schedule.now(),
					countdown.clientId,
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
						<span
							role="timer"
							aria-label={
								rest
									? text("client.timers.rest-remaining")
									: text("client.timers.execution-remaining")
							}
						>
							{formatClock(remaining)}
						</span>
						<span className="text-sm font-medium text-text-subtle">
							{" "}
							{text("client.timers.of-total", { total: formatClock(total) })}
						</span>
					</p>
				</div>
				{props.dock ? (
					<IconButton
						tone="filled"
						onClick={toggle}
						disabled={props.disabled}
						label={text("client.timers.toggle", {
							action: paused ? "resume" : "pause",
							subject: rest ? "rest" : "set_timer",
						})}
					>
						<AppIcon size={18} name={paused ? "play" : "pause"} />
					</IconButton>
				) : null}
				{props.dock && !rest ? (
					<Button onClick={props.onFinish} disabled={props.disabled}>
						{text("common.action.done")}
					</Button>
				) : null}
			</div>
			<ProgressBar
				max={total}
				value={total - remaining}
				tone={rest ? "accent" : "info"}
				fillClassName="duration-1000 ease-linear"
				label={rest ? text("client.timers.rest-progress") : text("client.timers.timer-progress")}
			/>
			<div className={clsx("flex flex-wrap items-center gap-1.5", props.dock && "*:flex-1")}>
				{props.dock ? null : (
					<Button size="sm" onClick={toggle} variant="secondary" disabled={props.disabled}>
						<AppIcon size={14} name={paused ? "play" : "pause"} />
						{paused ? text("client.timers.resume") : text("client.timers.pause")}
					</Button>
				)}
				{rest ? (
					<Button
						size="sm"
						variant="secondary"
						disabled={props.disabled}
						onClick={() => shift(-15)}
						aria-label={text("client.timers.subtract")}
					>
						{text("client.timers.minus-15")}
					</Button>
				) : null}
				<Button
					size="sm"
					variant="secondary"
					onClick={() => shift(15)}
					disabled={props.disabled}
					aria-label={text("client.timers.add")}
				>
					{text("client.timers.plus-15")}
				</Button>
				<Button size="sm" onClick={skip} variant="ghost" disabled={props.disabled}>
					{rest ? text("client.timers.skip-rest") : text("client.timers.skip-timer")}
				</Button>
				{!props.dock && !rest ? (
					<Button size="sm" className="ml-auto" onClick={props.onFinish} disabled={props.disabled}>
						{text("client.timers.done-now")}
					</Button>
				) : null}
			</div>
		</div>
	);
}

const activeTimer = (text: FitnessText, props: TimerProps, dock: boolean) => {
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
				heading={text("client.timers.working", {
					state: countdown.pausedRemainingSeconds === undefined ? "running" : "paused",
					name: props.names.get(countdown.exerciseId) ?? text("client.editor.exercise"),
				})}
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
				heading={
					props.nextSet === undefined
						? text("client.timers.resting", {
								state: countdown.pausedRemainingSeconds === undefined ? "running" : "paused",
							})
						: text("client.timers.resting-next", {
								next: props.nextSet.name,
								state: countdown.pausedRemainingSeconds === undefined ? "running" : "paused",
							})
				}
			/>
		);
	}
	return undefined;
};

const timerStateKey = (draft: WorkoutEditorDraft) => {
	if (draft.executionCountdown !== undefined) {
		return `execution:${draft.executionCountdown.clientId}`;
	}
	if (draft.pendingRest !== undefined) {
		return `prompt:${draft.pendingRest.setId}`;
	}
	return draft.restCountdown === undefined ? "idle" : `rest:${draft.restCountdown.clientId}`;
};

export function RailTimers(props: TimerProps & { readonly startedAt: string | undefined }) {
	const text = useFitnessMessages();
	const schedule = useRyotSchedule();
	const { draft } = props;
	const paused = draft.activeDurationStartedAt === undefined;
	const active = activeTimer(text, props, false);
	return (
		<>
			<Card className="grid gap-2.5 p-3.5">
				<div className="flex items-center gap-2">
					<Badge dot variant={paused ? "warning" : "success"}>
						{paused ? text("client.timers.paused") : text("client.timers.active")}
					</Badge>
					<span className="flex-1" />
					{props.startedAt === undefined ? null : (
						<span className="text-xs text-text-muted">
							{text("client.home.draft-started", { time: props.startedAt })}
						</span>
					)}
				</div>
				<p
					role="timer"
					className="text-timer font-semibold tabular-nums"
					aria-label={text("client.workout.active-duration")}
				>
					{formatClock(activeDurationSeconds(draft, props.now) ?? 0)}
				</p>
				<Button
					size="sm"
					variant="secondary"
					disabled={props.disabled}
					onClick={() =>
						props.onChange((current) => toggleWorkoutPause(current, schedule.now()).draft)
					}
				>
					<AppIcon size={14} name={paused ? "play" : "pause"} />
					{paused ? text("client.home.draft-live-resume") : text("client.editor.pause")}
				</Button>
			</Card>
			<Card className="p-3.5">
				<MotionSwap stateKey={timerStateKey(draft)}>
					{active ?? (
						<StopwatchControls
							draft={draft}
							now={props.now}
							disabled={props.disabled}
							onChange={props.onChange}
						/>
					)}
				</MotionSwap>
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

export function DockTimers(
	props: TimerProps & {
		readonly onAddExercises: () => void;
		readonly onJumpToSet: (setId: string) => void;
	},
) {
	const text = useFitnessMessages();
	const schedule = useRyotSchedule();
	const active = activeTimer(text, props, true);
	if (active !== undefined) {
		return <MotionSwap stateKey={timerStateKey(props.draft)}>{active}</MotionSwap>;
	}
	const running = props.draft.stopwatchStartedAt !== undefined;
	const stopwatch = stopwatchSeconds(props.draft, props.now);
	return (
		<MotionSwap stateKey="idle">
			<div className="flex items-center gap-2">
				{running || stopwatch > 0 ? (
					<button
						type="button"
						disabled={props.disabled}
						onClick={() => props.onChange((draft) => toggleStopwatch(draft, schedule.now()).draft)}
						aria-label={text("client.timers.stopwatch-toggle", {
							time: formatClock(stopwatch),
							action: running ? "pause" : "resume",
						})}
						className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill border border-border-emphasis bg-surface px-3 text-[13px] font-medium tabular-nums pointer-coarse:h-10"
					>
						<AppIcon size={14} name={running ? "pause" : "timer"} />
						{formatClock(stopwatch)}
					</button>
				) : null}
				{props.nextSet === undefined ? (
					<p className="min-w-0 flex-1 text-sm font-semibold">{text("client.timers.all-done")}</p>
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
						<span className="block text-xs text-text-muted">{text("client.timers.up-next")}</span>
						<span className="block truncate text-sm font-semibold">
							{text("client.timers.next-set", {
								name: props.nextSet.name,
								number: props.nextSet.number,
							})}
						</span>
					</button>
				)}
				<Button variant="secondary" disabled={props.disabled} onClick={props.onAddExercises}>
					<AppIcon size={16} name="plus" />
					{text("client.editor.exercise")}
				</Button>
			</div>
		</MotionSwap>
	);
}
