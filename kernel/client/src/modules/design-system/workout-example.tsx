import {
	Badge,
	Button,
	Card,
	CellInput,
	IconButton,
	MenuButton,
	Tooltip,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { EntityArtWell } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { useState, type ReactNode } from "react";

import { EXERCISES, type ExerciseFixture, type SetFixture } from "#/modules/design-system/fixtures";
import { useEdge } from "#/modules/shell/authenticated-shell-context";

const SET_KINDS = [
	{ key: "normal", tag: undefined, label: "Normal", tone: "text-text" },
	{ tag: "W", key: "warmup", label: "Warm-up", tone: "text-warning" },
	{ tag: "D", key: "drop", label: "Drop set", tone: "text-info" },
	{ tag: "F", key: "failure", label: "Failure", tone: "text-danger" },
] as const;

const noop = () => {};

const setGrid = (compact: boolean) =>
	compact
		? "grid grid-cols-[1.75rem_minmax(0,1fr)_4.25rem_4.25rem_2.75rem] items-center gap-1.5 px-1.5"
		: "grid grid-cols-[2.25rem_minmax(4rem,1fr)_5.5rem_5.5rem_2.75rem_2.25rem] items-center gap-2 px-2 pointer-coarse:grid-cols-[2.25rem_minmax(3rem,1fr)_4.5rem_4.5rem_2.75rem_2.75rem]";

function SetKindButton(props: {
	readonly index: number;
	readonly kind: SetFixture["kind"];
	readonly onChange: (kind: SetFixture["kind"]) => void;
}) {
	const kind = SET_KINDS.find((candidate) => candidate.key === props.kind) ?? SET_KINDS[0];
	return (
		<MenuButton
			label={`Set ${props.index}, ${kind.label}. Change set type`}
			items={[
				...SET_KINDS.map((candidate) => ({
					key: candidate.key,
					onSelect: () => props.onChange(candidate.key),
					label: candidate.key === props.kind ? `${candidate.label} ✓` : candidate.label,
				})),
				{ key: "delete", onSelect: noop, destructive: true, label: "Delete set" },
			]}
			renderTrigger={(trigger) => (
				<button
					{...trigger}
					type="button"
					aria-label={`Set ${props.index}, ${kind.label}. Change set type`}
					className={clsx(
						"h-7 min-w-7 justify-self-start rounded-sm px-1.5 text-[13px] font-semibold tabular-nums hover:bg-hover",
						kind.tone,
					)}
				>
					{kind.tag ?? props.index}
				</button>
			)}
		/>
	);
}

function RestLine(props: {
	readonly label: string;
	readonly active?: boolean;
	readonly compact: boolean;
}) {
	return (
		<div
			className={clsx(
				"flex items-center gap-2.5 py-0.5 pr-2 text-xs font-medium tabular-nums",
				props.compact ? "pl-8" : "pl-12",
				props.active === true ? "text-accent-text" : "text-text-subtle",
			)}
		>
			<span className={clsx("h-px flex-1", props.active === true ? "bg-accent" : "bg-border")} />
			<AppIcon size={13} name="timer" />
			{props.label}
			<span className="h-px flex-1 bg-border" />
		</div>
	);
}

function SetRow(props: {
	readonly set: SetFixture;
	readonly index: number;
	readonly current: boolean;
	readonly compact: boolean;
	readonly columns: readonly [string, string];
	readonly onChange: (set: SetFixture) => void;
}) {
	const { set } = props;
	const label = `Set ${props.index}`;
	const detail = set.error ?? set.note;
	return (
		<div
			className={clsx(
				"rounded-md py-1 transition-colors duration-150 motion-reduce:transition-none",
				set.done && "bg-success-soft",
				props.current && !set.done && "ring-1 ring-border-emphasis",
			)}
		>
			<div className={setGrid(props.compact)}>
				<SetKindButton
					kind={set.kind}
					index={props.index}
					onChange={(kind) => props.onChange({ ...set, kind })}
				/>
				<button
					type="button"
					aria-label={`${label}: use previous ${set.previous}`}
					className={clsx(
						"truncate py-1.5 text-left text-text-subtle tabular-nums hover:text-text hover:underline",
						props.compact ? "text-xs" : "text-[13px]",
					)}
				>
					{set.previous}
					{props.compact && set.rpe !== undefined && (
						<span className="ml-1.5 font-medium text-text-muted">@{set.rpe}</span>
					)}
				</button>
				<CellInput
					value={set.a}
					inputMode="decimal"
					placeholder={props.columns[0]}
					invalid={set.error !== undefined}
					aria-label={`${label} ${props.columns[0]}`}
					onChange={(event) => props.onChange({ ...set, a: event.currentTarget.value })}
					className={clsx(set.done && "border-transparent bg-transparent font-semibold")}
				/>
				<CellInput
					value={set.b}
					inputMode="numeric"
					placeholder={props.columns[1]}
					aria-label={`${label} ${props.columns[1]}`}
					onChange={(event) => props.onChange({ ...set, b: event.currentTarget.value })}
					className={clsx(set.done && "border-transparent bg-transparent font-semibold")}
				/>
				{!props.compact && (
					<button
						type="button"
						aria-label={`${label} RPE and notes`}
						className={clsx(
							"h-7 rounded-sm text-xs font-medium tabular-nums hover:bg-hover",
							set.rpe === undefined ? "text-text-subtle" : "text-text",
						)}
					>
						{set.rpe === undefined ? "RPE" : `@${set.rpe}`}
					</button>
				)}
				<button
					type="button"
					aria-pressed={set.done}
					aria-label={`Complete ${label.toLowerCase()}`}
					onClick={() => props.onChange({ ...set, done: !set.done })}
					className={clsx(
						"flex size-9 items-center justify-center justify-self-end rounded-md border-[1.5px] transition-[background-color,border-color,color,transform] duration-100 active:scale-95 motion-reduce:transition-none pointer-coarse:size-11",
						set.done
							? "border-success bg-success text-surface"
							: "border-border-emphasis text-text-subtle hover:border-success hover:text-success",
					)}
				>
					<AppIcon size={16} name="check" />
				</button>
			</div>
			{detail !== undefined && (
				<p
					role={set.error === undefined ? undefined : "alert"}
					className={clsx(
						"flex items-start gap-1.5 pt-0.5 pr-2 pb-1 text-xs",
						props.compact ? "pl-9" : "pl-13",
						set.error === undefined ? "text-text-muted" : "font-medium text-danger",
					)}
				>
					{set.error === undefined && (
						<span className="mt-px shrink-0">
							<AppIcon size={13} name="pencil" />
						</span>
					)}
					{detail}
				</p>
			)}
		</div>
	);
}

function ExerciseCard(props: {
	readonly compact: boolean;
	readonly activeRest: boolean;
	readonly exercise: ExerciseFixture;
	readonly onChange: (exercise: ExerciseFixture) => void;
}) {
	const { compact, exercise } = props;
	const firstOpen = exercise.sets.findIndex((set) => !set.done);
	return (
		<Card
			padding="none"
			className={clsx("grid gap-2.5 pb-2", compact ? "px-2 pt-3" : "px-3 pt-3.5")}
		>
			<header className="flex items-start gap-3 px-1">
				<EntityArtWell
					state="ready"
					shape="rounded"
					url={exercise.art}
					monogram={exercise.name.slice(0, 1)}
					className={clsx("shrink-0", compact ? "size-9" : "size-10")}
				/>
				<div className="min-w-0 flex-1">
					<h3 className="text-[15px] leading-5 font-semibold [overflow-wrap:anywhere] text-text">
						{exercise.name}
					</h3>
					<p className="mt-0.5 text-xs text-text-muted">{exercise.meta}</p>
				</div>
				{!compact && (
					<Button size="sm" variant="ghost">
						<AppIcon size={15} name="history" />
						History
					</Button>
				)}
				<MenuButton
					label={`${exercise.name} actions`}
					icon={<AppIcon size={16} name="more-horizontal" />}
					items={[
						{ key: "history", onSelect: noop, label: "History" },
						{ onSelect: noop, key: "defaults", label: "Exercise defaults" },
						{ onSelect: noop, key: "instructions", label: "Instructions and notes" },
						{ key: "replace", onSelect: noop, label: "Replace exercise" },
						{ key: "remove", onSelect: noop, destructive: true, label: "Remove exercise" },
					]}
				/>
			</header>
			{exercise.note !== undefined && (
				<p className="mx-1 rounded-md bg-surface-2 px-3 py-2 text-[13px] text-text-muted">
					{exercise.note}
				</p>
			)}
			<div role="group" className="grid gap-0.5" aria-label={`${exercise.name} sets`}>
				<div
					aria-hidden="true"
					className={clsx(
						setGrid(compact),
						"text-[11px] font-medium tracking-[0.05em] text-text-subtle uppercase",
					)}
				>
					<span>Set</span>
					<span>{compact ? "Prev" : "Previous"}</span>
					<span className="text-center">{exercise.columns[0]}</span>
					<span className="text-center">{exercise.columns[1]}</span>
					{!compact && <span className="text-center">RPE</span>}
					<span className="flex justify-end pr-3">
						<AppIcon size={13} name="check" />
					</span>
				</div>
				{exercise.sets.map((set, index) => {
					const number = exercise.sets
						.slice(0, index + 1)
						.filter(({ kind }) => kind !== "warmup").length;
					const resting = props.activeRest && index + 1 === firstOpen;
					return (
						<div key={set.id}>
							<SetRow
								set={set}
								index={number}
								compact={compact}
								columns={exercise.columns}
								current={index === firstOpen}
								onChange={(next) =>
									props.onChange({
										...exercise,
										sets: exercise.sets.map((candidate) =>
											candidate.id === next.id ? next : candidate,
										),
									})
								}
							/>
							{set.done && index + 1 < exercise.sets.length && (
								<RestLine
									active={resting}
									compact={compact}
									label={resting ? "Resting 1:24 / 2:00" : "2:00"}
								/>
							)}
						</div>
					);
				})}
			</div>
			<footer className="flex items-center gap-1">
				<Button size="sm" variant="ghost">
					<AppIcon size={15} name="plus" />
					Add set
				</Button>
				<Button size="sm" variant="ghost">
					<AppIcon size={15} name="pencil" />
					Note
				</Button>
				<span className="ml-auto px-2 text-xs text-text-subtle">{exercise.restLabel}</span>
			</footer>
		</Card>
	);
}

function Stat(props: {
	readonly label: string;
	readonly compact: boolean;
	readonly children: ReactNode;
}) {
	return (
		<div className="grid min-w-0 gap-0.5">
			<span className="text-xs text-text-muted">{props.label}</span>
			<span
				className={clsx(
					"font-semibold whitespace-nowrap text-text tabular-nums",
					props.compact ? "text-lg leading-6" : "text-metric",
				)}
			>
				{props.children}
			</span>
		</div>
	);
}

function RestProgress() {
	return (
		<div
			aria-valuemin={0}
			role="progressbar"
			aria-valuenow={84}
			aria-valuemax={120}
			aria-label="Rest timer"
			className="h-1 overflow-hidden rounded-full bg-surface-2"
		>
			<div className="h-full w-[70%] rounded-full bg-accent" />
		</div>
	);
}

function RestAdjust() {
	return (
		<div className="flex items-center gap-1.5">
			<Button size="sm" variant="secondary">
				−15s
			</Button>
			<Button size="sm" variant="secondary">
				+15s
			</Button>
			<Button size="sm" variant="ghost">
				Skip
			</Button>
		</div>
	);
}

function ClockBar() {
	return (
		<Card className="flex flex-wrap items-center gap-x-5 gap-y-3 py-3">
			<Badge dot variant="accent">
				Resting
			</Badge>
			<div className="grid min-w-48 flex-1 gap-1.5">
				<div className="flex items-baseline justify-between gap-3">
					<span className="text-2xl font-semibold text-text tabular-nums">1:24</span>
					<span className="text-xs text-text-muted tabular-nums">
						of 2:00 · next: Incline press
					</span>
				</div>
				<RestProgress />
			</div>
			<RestAdjust />
			<span aria-hidden="true" className="h-8 w-px bg-border" />
			<div className="flex items-center gap-2">
				<span className="text-xs text-text-muted">Stopwatch</span>
				<span className="text-sm font-semibold text-text tabular-nums">0:00</span>
				<Tooltip content="Start stopwatch">
					{(describedBy) => (
						<IconButton
							size="sm"
							tone="filled"
							label="Start stopwatch"
							aria-describedby={describedBy}
						>
							<AppIcon size={15} name="play" />
						</IconButton>
					)}
				</Tooltip>
			</div>
		</Card>
	);
}

function RestDock() {
	return (
		<div className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 -mx-1">
			<div className="grid gap-2.5 rounded-xl border border-border bg-raised px-3.5 pt-3 pb-3 shadow-modal">
				<div className="flex items-center gap-3">
					<div className="grid min-w-0 flex-1">
						<span className="text-xs font-medium text-accent-text">
							Resting · next Incline press
						</span>
						<span className="text-2xl leading-7 font-semibold text-text tabular-nums">
							1:24
							<span className="text-sm font-medium text-text-subtle"> / 2:00</span>
						</span>
					</div>
					<RestAdjust />
				</div>
				<RestProgress />
			</div>
		</div>
	);
}

function Toolbar(props: { readonly compact: boolean }) {
	const secondary = (
		<>
			<Button size="sm" variant="ghost" className="shrink-0">
				Reorder
			</Button>
			<Button size="sm" variant="ghost" className="shrink-0">
				Supersets
			</Button>
			<Button size="sm" variant="ghost" className="shrink-0">
				Bulk delete
			</Button>
		</>
	);
	const tools = (
		<>
			<Button size="sm" variant="ghost" className="shrink-0">
				<AppIcon size={15} name="ruler" />
				Log measurement
			</Button>
			<Button size="sm" variant="ghost" className="shrink-0">
				<AppIcon size={15} name="image" />
				Attachments
			</Button>
		</>
	);
	if (props.compact) {
		return (
			<div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
				<Button size="sm" className="shrink-0">
					<AppIcon size={15} name="plus" />
					Add exercises
				</Button>
				<Button size="sm" variant="secondary" className="shrink-0">
					<AppIcon size={15} name="timer" />
					<span className="tabular-nums">0:00</span>
					<span className="sr-only">Start stopwatch</span>
				</Button>
				{secondary}
				{tools}
				<IconButton size="sm" className="shrink-0" label="Workout preferences">
					<AppIcon size={16} name="sliders-horizontal" />
				</IconButton>
			</div>
		);
	}
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<Button size="sm">
				<AppIcon size={15} name="plus" />
				Add exercises
			</Button>
			{secondary}
			<span className="flex-1" />
			{tools}
			<IconButton size="sm" label="Workout preferences">
				<AppIcon size={16} name="sliders-horizontal" />
			</IconButton>
		</div>
	);
}

export function WorkoutExample() {
	const { compact } = useEdge();
	const [exercises, setExercises] = useState(EXERCISES);
	const completed = exercises.flatMap((exercise) => exercise.sets).filter((set) => set.done).length;
	const total = exercises.flatMap((exercise) => exercise.sets).length;
	const update = (next: ExerciseFixture) =>
		setExercises((current) =>
			current.map((exercise) => (exercise.id === next.id ? next : exercise)),
		);
	const solo = exercises.filter((exercise) => exercise.superset === undefined);
	const superset = exercises.filter((exercise) => exercise.superset !== undefined);
	const card = (exercise: ExerciseFixture, activeRest: boolean) => (
		<ExerciseCard
			key={exercise.id}
			compact={compact}
			onChange={update}
			exercise={exercise}
			activeRest={activeRest}
		/>
	);

	const stats = (
		<div className={compact ? "grid grid-cols-4 gap-3" : "flex flex-wrap gap-x-7 gap-y-3"}>
			<Stat label="Duration" compact={compact}>
				42:18
			</Stat>
			<Stat label="Sets" compact={compact}>
				{completed}
				<span className="text-sm font-medium text-text-subtle">/{total}</span>
			</Stat>
			<Stat label="Volume" compact={compact}>
				3,240<span className="text-xs font-medium text-text-subtle"> kg</span>
			</Stat>
			<Stat label="Reps" compact={compact}>
				58
			</Stat>
		</div>
	);

	return (
		<div className={clsx("grid max-w-4xl", compact ? "gap-4" : "gap-5")}>
			{compact ? (
				<div className="grid gap-3">
					<div className="flex items-start gap-2">
						<h2 className="min-w-0 flex-1 text-[17px] leading-6 font-semibold text-balance text-text">
							Push day: chest, shoulders & triceps
						</h2>
						<IconButton size="sm" tone="filled" label="Pause workout">
							<AppIcon size={15} name="pause" />
						</IconButton>
						<Button size="sm">Finish</Button>
						<MenuButton
							label="Workout actions"
							icon={<AppIcon size={16} name="more-horizontal" />}
							items={[
								{ key: "details", onSelect: noop, label: "Name and reflection" },
								{ key: "cancel", onSelect: noop, destructive: true, label: "Cancel workout" },
							]}
						/>
					</div>
					{stats}
				</div>
			) : (
				<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
					<div className="grid gap-3">
						<h2 className="text-heading font-semibold text-text">
							Push day: chest, shoulders & triceps
						</h2>
						{stats}
					</div>
					<div className="flex items-center gap-2">
						<Button variant="ghost">Cancel</Button>
						<Button variant="secondary">
							<AppIcon size={15} name="pause" />
							Pause
						</Button>
						<Button>Finish</Button>
					</div>
				</div>
			)}

			{!compact && <ClockBar />}

			<Toolbar compact={compact} />

			<div className="grid gap-3">
				{solo.slice(0, 1).map((exercise) => card(exercise, true))}
				<section
					aria-label="Superset A"
					className={clsx("relative grid gap-2", compact ? "pl-3" : "pl-4")}
				>
					<span
						aria-hidden="true"
						className={clsx(
							"absolute top-8 bottom-3 w-0.5 rounded-full bg-info",
							compact ? "left-0" : "left-1",
						)}
					/>
					<p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-info uppercase">
						<AppIcon size={13} name="link" />
						Superset A · 3 rounds
					</p>
					{superset.map((exercise) => card(exercise, false))}
				</section>
				{solo.slice(1).map((exercise) => card(exercise, false))}
			</div>

			{compact && <RestDock />}
		</div>
	);
}
