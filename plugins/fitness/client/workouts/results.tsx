import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { Badge, Card } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useState, type ReactNode } from "react";

import { tableHeaderClass } from "../measurements/styles";
import { formatNumber } from "../workout/format";
import { changeTone, formatChange, plural, type WeekSection, type WorkoutCard } from "./model";
import { toneClasses } from "./styles";

function WorkoutName(props: { readonly card: WorkoutCard; readonly className?: string }) {
	return (
		<PluginLink to={{ kind: "entity", entityId: props.card.id }}>
			<span className={clsx("font-semibold text-text", props.className)}>{props.card.name}</span>
		</PluginLink>
	);
}

function RecordBadge(props: { readonly count: number }) {
	return props.count > 0 ? (
		<Badge variant="accent">
			<AppIcon size={12} name="star" />
			{plural(props.count, "PR")}
		</Badge>
	) : null;
}

const muscleList = (card: WorkoutCard) =>
	card.moreMuscles > 0 ? [...card.muscles, `+${card.moreMuscles}`] : card.muscles;

function Comparison(props: { readonly card: WorkoutCard }) {
	const { comparison } = props.card;
	if (comparison.kind === "none") {
		return <span className="text-text-subtle">Started empty · nothing to compare</span>;
	}
	return (
		<>
			<span className="truncate text-text-subtle">{comparison.label}</span>
			{comparison.change === null ? null : (
				<span
					className={clsx(
						"font-semibold whitespace-nowrap tabular-nums",
						toneClasses[changeTone(comparison.change)],
					)}
				>
					{formatChange(comparison.change)} volume
				</span>
			)}
		</>
	);
}

function RecordCount(props: { readonly count: number; readonly className?: string }) {
	return (
		<span
			className={clsx(
				"font-semibold",
				props.count > 0 ? "text-accent-text" : "text-text-subtle",
				props.className,
			)}
		>
			{props.count > 0 ? formatNumber(props.count) : "—"}
		</span>
	);
}

function Stat(props: { readonly value: ReactNode; readonly label: string }) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<span className="text-[18px] font-semibold whitespace-nowrap text-text tabular-nums">
				{props.value}
			</span>
			<span className="text-[12px] text-text-subtle">{props.label}</span>
		</div>
	);
}

export function WorkoutGridCard(props: { readonly card: WorkoutCard }) {
	const { card } = props;
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
								{card.day} · {card.time}
							</span>
						)}
					</div>
					<RecordBadge count={card.personalBests} />
				</div>
				<div className="grid grid-cols-3 gap-2 px-4.5 py-3.5">
					<Stat value={card.duration?.value ?? "—"} label={card.duration?.label ?? "Duration"} />
					<Stat label="Volume" value={card.volume ?? "—"} />
					<Stat
						value={formatNumber(card.sets)}
						label={`Sets · ${plural(card.exercises, "exercise")}`}
					/>
				</div>
				{card.muscles.length === 0 ? null : (
					<ul aria-label="Muscles" className="flex flex-wrap gap-1.5 px-4.5 pb-3.5">
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
									{line.name}
									{line.record ? <span className="ml-1.5 text-accent-text">★</span> : null}
								</span>
								<span
									className={clsx(
										"whitespace-nowrap tabular-nums",
										line.record ? "text-accent-text" : "text-text-muted",
									)}
								>
									{line.best}
								</span>
							</li>
						))}
						{card.moreExercises > 0 ? (
							<li className="text-[13px] text-text-subtle">
								+{plural(card.moreExercises, "more exercise")}
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
							<span className="text-[13px] text-text-muted">· {muscles.join(", ")}</span>
						)}
					</div>
					<span className="truncate text-[13.5px] text-text-muted">
						{card.lines.map(({ name }) => name).join(", ")}
					</span>
				</div>
				<div className="grid flex-[1_1_420px] grid-cols-[repeat(4,minmax(0,1fr))_auto] items-center gap-3 text-right text-[14px] tabular-nums">
					<span>
						<span className="block font-semibold text-text">{card.duration?.value ?? "—"}</span>
						<span className="text-[11.5px] text-text-subtle">
							{(card.duration?.label ?? "Duration").toLowerCase()}
						</span>
					</span>
					<span>
						<span className="block font-semibold text-text">{card.volume ?? "—"}</span>
						<span
							className={clsx(
								"text-[11.5px]",
								card.comparison.kind === "none"
									? "text-text-subtle"
									: toneClasses[changeTone(card.comparison.change)],
							)}
						>
							{card.comparison.kind === "none" || card.comparison.change === null
								? "no comparison"
								: formatChange(card.comparison.change)}
						</span>
					</span>
					<span>
						<span className="block font-semibold text-text">{formatNumber(card.sets)}</span>
						<span className="text-[11.5px] text-text-subtle">sets</span>
					</span>
					<span>
						<RecordCount className="block" count={card.personalBests} />
						<span className="text-[11.5px] text-text-subtle">PRs</span>
					</span>
					<button
						type="button"
						aria-expanded={open}
						onClick={() => setOpen((current) => !current)}
						aria-label={`${open ? "Collapse" : "Expand"} ${card.name}`}
						className="grid size-7 place-items-center rounded-md bg-surface-2 text-text-muted"
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
									Exercise
								</th>
								<th scope="col" className={clsx(tableHeaderClass, "text-right")}>
									Sets
								</th>
								<th scope="col" className={clsx(tableHeaderClass, "text-right")}>
									Best set
								</th>
							</tr>
						</thead>
						<tbody>
							{card.lines.map((line) => (
								<tr key={line.key} className="border-t border-border">
									<td className="px-3 py-2 text-text">
										{line.name}
										{line.record ? (
											<span className="ml-1.5 text-[12px] text-accent-text">★ PR</span>
										) : null}
									</td>
									<td className="px-3 py-2 text-right text-text-muted">{line.sets}</td>
									<td className="px-3 py-2 text-right">{line.best}</td>
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

export function WorkoutWeeks(props: {
	readonly layout: "grid" | "list";
	readonly sections: readonly WeekSection[];
}) {
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
								<WorkoutGridCard card={card} key={card.id} />
							))}
						</div>
					) : (
						<div className="flex flex-col">
							{section.cards.map((card) => (
								<WorkoutListRow card={card} key={card.id} />
							))}
						</div>
					)}
				</section>
			))}
		</div>
	);
}

const numericHeader = clsx(tableHeaderClass, "text-right");

export function WorkoutTable(props: { readonly cards: readonly WorkoutCard[] }) {
	return (
		<Card padding="none" className="overflow-x-auto font-ui">
			<table className="w-full min-w-235 border-collapse text-[14px] tabular-nums">
				<thead>
					<tr>
						<th scope="col" className={tableHeaderClass}>
							Date
						</th>
						<th scope="col" className={tableHeaderClass}>
							Workout
						</th>
						<th scope="col" className={tableHeaderClass}>
							Muscles
						</th>
						<th scope="col" className={numericHeader}>
							Duration
						</th>
						<th scope="col" className={numericHeader}>
							Exercises
						</th>
						<th scope="col" className={numericHeader}>
							Sets
						</th>
						<th scope="col" className={numericHeader}>
							Volume
						</th>
						<th scope="col" className={numericHeader}>
							PRs
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
								<WorkoutName card={card} />
							</td>
							<td className="px-3 py-2.5 text-[13px] text-text-muted">
								{card.muscles.join(", ") || "—"}
							</td>
							<td className="px-3 py-2.5 text-right">
								{card.duration === null ? "—" : card.duration.value}
								{card.duration?.label === "Elapsed" ? (
									<span className="block text-[11.5px] text-text-subtle">elapsed</span>
								) : null}
							</td>
							<td className="px-3 py-2.5 text-right text-text-muted">
								{formatNumber(card.exercises)}
							</td>
							<td className="px-3 py-2.5 text-right text-text-muted">{formatNumber(card.sets)}</td>
							<td className="px-3 py-2.5 text-right">{card.volume ?? "—"}</td>
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
