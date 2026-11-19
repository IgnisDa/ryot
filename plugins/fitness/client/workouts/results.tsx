import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { useDisplayText, useFormatters } from "@ryot-app/plugin-client-sdk/react";
import {
	Badge,
	Card,
	formatDuration,
	type ItemSelection,
	SelectableItem,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { type ReactNode, useState } from "react";

import { tableHeaderClass } from "../measurements/styles";
import { useFitnessMessages } from "../messages";
import { formatNumber, formatSetMain } from "../workout/format";
import {
	cardVolume,
	changeTone,
	comparisonLabel,
	countLabel,
	describeDuration,
	formatChange,
	type WeekSection,
	type WorkoutCard,
} from "./model";
import { toneClasses } from "./styles";

function WorkoutName(props: { readonly card: WorkoutCard; readonly className?: string }) {
	return (
		<PluginLink to={{ kind: "entity", entityId: props.card.id }}>
			<span className={clsx("font-semibold text-text", props.className)}>{props.card.name}</span>
		</PluginLink>
	);
}

function RecordBadge(props: { readonly count: null | number }) {
	const text = useFitnessMessages();
	return props.count !== null && props.count > 0 ? (
		<Badge variant="accent">
			<AppIcon size={12} name="star" />
			{countLabel(text, "pr", props.count)}
		</Badge>
	) : null;
}

const muscleList = (card: WorkoutCard) =>
	card.moreMuscles > 0 ? [...card.muscles, `+${card.moreMuscles}`] : card.muscles;

export function WorkoutWeeks(props: {
	readonly layout: "grid" | "list";
	readonly sections: readonly WeekSection[];
	readonly selection: undefined | ItemSelection;
}) {
	const displayText = useDisplayText();
	return (
		<div className="flex min-w-0 flex-col gap-7 font-ui">
			{props.sections.map((section) => (
				<section key={section.key} aria-label={section.title} className="flex flex-col gap-3.5">
					<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-border pb-2.5">
						<h2 className="text-[18px] font-semibold text-text">
							{section.title}
							{section.range === null ? null : (
								<span className="ml-2 text-[14px] font-normal text-text-subtle">
									{section.range}
								</span>
							)}
						</h2>
						{section.totals === null ? null : (
							<span className="text-[13.5px] text-text-muted tabular-nums">{section.totals}</span>
						)}
					</div>
					{props.layout === "grid" ? (
						<div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5">
							{section.cards.map((card) => (
								<SelectableItem
									id={card.id}
									key={card.id}
									selection={props.selection}
									label={displayText(card.name)}
								>
									<WorkoutGridCard card={card} />
								</SelectableItem>
							))}
						</div>
					) : (
						<div className="flex flex-col">
							{section.cards.map((card) => (
								<SelectableItem
									id={card.id}
									key={card.id}
									selection={props.selection}
									label={displayText(card.name)}
								>
									<WorkoutListRow card={card} />
								</SelectableItem>
							))}
						</div>
					)}
				</section>
			))}
		</div>
	);
}

export function WorkoutGridCard(props: { readonly card: WorkoutCard }) {
	const { card } = props;
	const { best, text, volume, duration, formatters } = useCardText(card);
	return (
		<Card padding="none" className="flex min-w-0 flex-col overflow-hidden">
			<article
				data-layout="grid"
				aria-label={card.name}
				data-entity-id={card.id}
				className="flex flex-1 flex-col"
			>
				<div className="flex items-start justify-between gap-3 px-4.5 pt-4">
					<div className="flex min-w-0 flex-col gap-0.5">
						<WorkoutName card={card} className="text-[18px]" />
						{card.day === null ? null : (
							<span className="text-[13px] text-text-muted tabular-nums">
								<span>{card.day}</span> · <span>{card.time}</span>
							</span>
						)}
					</div>
					<RecordBadge count={card.personalBests} />
				</div>
				<div className="grid grid-cols-3 gap-2 px-4.5 py-3.5">
					<Stat
						value={duration?.value ?? "—"}
						label={duration?.label ?? text("property.duration")}
					/>
					<Stat value={volume ?? "—"} label={text("property.volume")} />
					<Stat
						value={formatNumber(formatters, card.sets)}
						label={text("client.workouts.sets-exercises", {
							exercises: countLabel(text, "exercise", card.exercises),
						})}
					/>
				</div>
				{card.muscles.length === 0 ? null : (
					<ul
						aria-label={text("browse.field.muscles")}
						className="flex flex-wrap gap-1.5 px-4.5 pb-3.5"
					>
						{muscleList(card).map((muscle) => (
							<li key={muscle}>
								<Badge variant="neutral">{muscle}</Badge>
							</li>
						))}
					</ul>
				)}
				{card.top.length === 0 ? null : (
					<ul className="flex flex-col gap-2 border-t border-border px-4.5 py-3 text-[13.5px]">
						{card.top.map((line) => (
							<li key={line.key} className="flex items-baseline gap-2.5">
								<span className="min-w-0 flex-1 truncate text-text">
									<span>{line.name}</span>
									{line.record ? <span className="ml-1.5 text-accent-text">★</span> : null}
								</span>
								<span
									className={clsx(
										"whitespace-nowrap tabular-nums",
										line.record ? "text-accent-text" : "text-text-muted",
									)}
								>
									{best(line)}
								</span>
							</li>
						))}
						{card.moreExercises > 0 ? (
							<li className="text-[13px] text-text-subtle">
								{text("client.workouts.more-exercises", { count: card.moreExercises })}
							</li>
						) : null}
					</ul>
				)}
				<div className="mt-auto flex items-center justify-between gap-2 border-t border-border bg-bg/40 px-4.5 py-2.5 text-[12.5px]">
					<Comparison card={card} />
				</div>
			</article>
		</Card>
	);
}

export function WorkoutListRow(props: { readonly card: WorkoutCard }) {
	const { card } = props;
	const { best, text, volume, duration, formatters } = useCardText(card);
	const [open, setOpen] = useState(false);
	const muscles = muscleList(card);
	return (
		<article
			data-layout="list"
			aria-label={card.name}
			data-entity-id={card.id}
			className="border-b border-border"
		>
			<div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-1 py-3.5">
				<div className="flex w-13 flex-none flex-col items-center rounded-md border border-border bg-surface py-1.5 tabular-nums">
					<span className="text-[11px] tracking-wider text-text-subtle">{card.weekday}</span>
					<span className="text-[20px] leading-tight font-semibold text-text">
						{card.dayOfMonth}
					</span>
				</div>
				<div className="flex min-w-0 flex-[999_1_300px] flex-col gap-1">
					<div className="flex flex-wrap items-baseline gap-x-2.5">
						<WorkoutName card={card} className="text-[16px]" />
						<span className="text-[13px] text-text-subtle tabular-nums">{card.time}</span>
						{muscles.length === 0 ? null : (
							<span className="text-[13px] text-text-muted">
								· {formatters.list({ type: "unit", style: "long" }).format(muscles)}
							</span>
						)}
					</div>
					<span className="truncate text-[13.5px] text-text-muted">
						{formatters
							.list({ type: "unit", style: "long" })
							.format(card.lines.map(({ name }) => name))}
					</span>
				</div>
				<div className="grid flex-[1_1_420px] grid-cols-[repeat(4,minmax(0,1fr))_auto] items-center gap-3 text-right text-[14px] tabular-nums">
					<span>
						<span className="block font-semibold text-text">{duration?.value ?? "—"}</span>
						<span className="text-[11.5px] text-text-subtle">
							{text("client.workouts.duration-caption", { kind: card.duration?.kind ?? "active" })}
						</span>
					</span>
					<span>
						<span className="block font-semibold text-text">{volume ?? "—"}</span>
						<span
							className={clsx(
								"text-[11.5px]",
								card.comparison.kind === "none"
									? "text-text-subtle"
									: toneClasses[changeTone(card.comparison.change)],
							)}
						>
							{card.comparison.kind === "none" || card.comparison.change === null
								? text("client.workouts.no-comparison")
								: formatChange(formatters, card.comparison.change)}
						</span>
					</span>
					<span>
						<span className="block font-semibold text-text">
							{formatNumber(formatters, card.sets)}
						</span>
						<span className="text-[11.5px] text-text-subtle">
							{text("client.workouts.sets-caption")}
						</span>
					</span>
					<span>
						<RecordCount className="block" count={card.personalBests} />
						<span className="text-[11.5px] text-text-subtle">
							{text("client.workouts.prs-caption")}
						</span>
					</span>
					<button
						type="button"
						aria-expanded={open}
						onClick={() => setOpen((current) => !current)}
						className="grid size-7 place-items-center rounded-md bg-surface-2 text-text-muted"
						aria-label={text(open ? "client.workouts.collapse" : "client.workouts.expand", {
							name: card.name,
						})}
					>
						<AppIcon size={14} name={open ? "chevron-up" : "chevron-down"} />
					</button>
				</div>
			</div>
			{open ? (
				<Card padding="none" className="mb-4 ml-0 overflow-x-auto @2xl:ml-18">
					<table className="w-full min-w-150 border-collapse text-[13.5px] tabular-nums">
						<thead>
							<tr>
								<th scope="col" className={tableHeaderClass}>
									{text("client.editor.exercise")}
								</th>
								<th scope="col" className={clsx(tableHeaderClass, "text-right")}>
									{text("property.sets")}
								</th>
								<th scope="col" className={clsx(tableHeaderClass, "text-right")}>
									{text("client.workouts.column-best-set")}
								</th>
							</tr>
						</thead>
						<tbody>
							{card.lines.map((line) => (
								<tr key={line.key} className="border-t border-border">
									<td className="px-3 py-2 text-text">
										<span>{line.name}</span>
										{line.record ? (
											<span className="ml-1.5 text-[12px] text-accent-text">
												★ {text("client.workouts.pr")}
											</span>
										) : null}
									</td>
									<td className="px-3 py-2 text-right text-text-muted">{line.sets}</td>
									<td className="px-3 py-2 text-right">{best(line)}</td>
								</tr>
							))}
						</tbody>
					</table>
					<div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-[13px]">
						<Comparison card={card} />
					</div>
				</Card>
			) : null}
		</article>
	);
}

function Stat(props: { readonly label: string; readonly value: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<span className="text-[18px] font-semibold whitespace-nowrap text-text tabular-nums">
				{props.value}
			</span>
			<span className="text-[12px] text-text-subtle">{props.label}</span>
		</div>
	);
}

function RecordCount(props: { readonly className?: string; readonly count: null | number }) {
	const formatters = useFormatters();
	return (
		<span
			className={clsx(
				"font-semibold",
				props.count !== null && props.count > 0 ? "text-accent-text" : "text-text-subtle",
				props.className,
			)}
		>
			{props.count !== null && props.count > 0 ? formatNumber(formatters, props.count) : "—"}
		</span>
	);
}

function useCardText(card: WorkoutCard) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	return {
		text,
		formatters,
		volume: cardVolume(formatters, text, card),
		duration: card.duration === null ? null : describeDuration(formatters, text, card.duration),
		best: (line: WorkoutCard["lines"][number]) =>
			formatSetMain(formatters, text, line.best.exerciseKind, line.best, card.imperial),
	};
}

function Comparison(props: { readonly card: WorkoutCard }) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { comparison } = props.card;
	if (comparison.kind === "none") {
		return <span className="text-text-subtle">{text("client.workouts.nothing-to-compare")}</span>;
	}
	return (
		<>
			<span className="truncate text-text-subtle">{comparisonLabel(text, comparison)}</span>
			{comparison.change === null ? null : (
				<span
					className={clsx(
						"font-semibold whitespace-nowrap tabular-nums",
						toneClasses[changeTone(comparison.change)],
					)}
				>
					{text("client.workouts.volume-change", {
						change: formatChange(formatters, comparison.change),
					})}
				</span>
			)}
		</>
	);
}

const numericHeader = clsx(tableHeaderClass, "text-right");

export function WorkoutTable(props: {
	readonly cards: readonly WorkoutCard[];
	readonly selection: undefined | ItemSelection;
}) {
	const displayText = useDisplayText();
	const text = useFitnessMessages();
	const formatters = useFormatters();
	return (
		<Card padding="none" className="overflow-x-auto font-ui">
			<table className="w-full min-w-235 border-collapse text-[14px] tabular-nums">
				<thead>
					<tr>
						<th scope="col" className={tableHeaderClass}>
							{text("client.workouts.column-date")}
						</th>
						<th scope="col" className={tableHeaderClass}>
							{text("client.workouts.column-workout")}
						</th>
						<th scope="col" className={tableHeaderClass}>
							{text("browse.field.muscles")}
						</th>
						<th scope="col" className={numericHeader}>
							{text("property.duration")}
						</th>
						<th scope="col" className={numericHeader}>
							{text("property.exercises")}
						</th>
						<th scope="col" className={numericHeader}>
							{text("property.sets")}
						</th>
						<th scope="col" className={numericHeader}>
							{text("property.volume")}
						</th>
						<th scope="col" className={numericHeader}>
							{text("client.workouts.prs-caption")}
						</th>
					</tr>
				</thead>
				<tbody>
					{props.cards.map((card) => (
						<tr key={card.id} className="border-t border-border">
							<td className="px-3 py-2.5 whitespace-nowrap">
								<span className="block text-text">{card.day ?? "—"}</span>
								<span className="text-[12px] text-text-subtle">{card.time}</span>
							</td>
							<td className="px-3 py-2.5">
								<SelectableItem
									id={card.id}
									selection={props.selection}
									label={displayText(card.name)}
								>
									<WorkoutName card={card} />
								</SelectableItem>
							</td>
							<td className="px-3 py-2.5 text-[13px] text-text-muted">
								{card.muscles.length === 0
									? "—"
									: formatters.list({ type: "unit", style: "long" }).format(card.muscles)}
							</td>
							<td className="px-3 py-2.5 text-right">
								{card.duration === null ? "—" : formatDuration(formatters, card.duration.seconds)}
								{card.duration?.kind === "elapsed" ? (
									<span className="block text-[11.5px] text-text-subtle">
										{text("client.workouts.elapsed-caption")}
									</span>
								) : null}
							</td>
							<td className="px-3 py-2.5 text-right text-text-muted">
								{formatNumber(formatters, card.exercises)}
							</td>
							<td className="px-3 py-2.5 text-right text-text-muted">
								{formatNumber(formatters, card.sets)}
							</td>
							<td className="px-3 py-2.5 text-right">
								{cardVolume(formatters, text, card) ?? "—"}
							</td>
							<td className="px-3 py-2.5 text-right">
								<RecordCount count={card.personalBests} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</Card>
	);
}
