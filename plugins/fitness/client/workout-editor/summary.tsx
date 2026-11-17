import { useFormatters } from "@ryot-app/plugin-client-sdk/react";
import { formatClock } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { includedWorkoutOccurrences } from "../../shared/workout-editor-transformations";
import {
	kilogramsToPounds,
	kilometersToMiles,
	milesToKilometers,
	poundsToKilograms,
} from "../../shared/workout-units";
import { useFitnessMessages } from "../messages";
import { formatUnitValue } from "../workout/format";
import { isTemplateDraft } from "./draft-ops";
import { activeDurationSeconds } from "./timers";

const quantity = (text: string | undefined) =>
	text !== undefined && text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= 0
		? Number(text)
		: 0;

export function EditorStats(props: {
	readonly now: number;
	readonly compact: boolean;
	readonly imperial: boolean;
	readonly draft: WorkoutEditorDraft;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { draft } = props;
	const included = includedWorkoutOccurrences(draft);
	let volumeKg = 0;
	let reps = 0;
	for (const { sets, occurrence } of included) {
		for (const set of sets) {
			reps += quantity(set.reps);
			const weight = quantity(set.weight);
			volumeKg +=
				quantity(set.reps) *
				(occurrence.display?.weightUnit === "lb" ? poundsToKilograms(weight) : weight);
		}
	}
	const distanceKm = included.reduce(
		(total, { sets, occurrence }) =>
			total +
			sets.reduce(
				(sum, set) =>
					sum +
					(occurrence.display?.distanceUnit === "mi"
						? milesToKilometers(quantity(set.distance))
						: quantity(set.distance)),
				0,
			),
		0,
	);
	const active = activeDurationSeconds(draft, props.now);
	const template = isTemplateDraft(draft);
	const total = draft.occurrences.reduce((count, { sets }) => count + sets.length, 0);
	const done = included.reduce((count, { sets }) => count + sets.length, 0);
	const stats: { readonly label: string; readonly value: string }[] = template
		? [
				{ label: text("property.exercises"), value: String(draft.occurrences.length) },
				{ value: String(total), label: text("client.editor.stat.planned-sets") },
			]
		: [
				{
					value: active === undefined ? text("client.editor.stat.unknown") : formatClock(active),
					label:
						draft.mode.kind === "historical"
							? text("client.editor.stat.active")
							: text("property.duration"),
				},
				{ label: text("property.sets"), value: text("client.wsheets.fraction", { done, total }) },
				{
					label: text("property.volume"),
					value: formatUnitValue(
						formatters,
						props.imperial ? kilogramsToPounds(volumeKg) : volumeKg,
						props.imperial ? "lb" : "kg",
						{ maximumFractionDigits: 1 },
					),
				},
				{ label: text("property.reps"), value: formatters.number().format(reps) },
				...(distanceKm > 0
					? [
							{
								label: text("property.distance"),
								value: formatUnitValue(
									formatters,
									props.imperial ? kilometersToMiles(distanceKm) : distanceKm,
									props.imperial ? "mi" : "km",
								),
							},
						]
					: []),
			];
	return (
		<dl
			className={props.compact ? "grid gap-2.5" : "flex flex-wrap gap-x-8 gap-y-3"}
			style={
				props.compact
					? { gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }
					: undefined
			}
		>
			{stats.map(({ label, value }) => (
				<div key={label} className="grid min-w-0 content-start gap-px">
					<dt className="text-xs text-text-muted">{label}</dt>
					<dd
						className={clsx(
							"font-semibold whitespace-nowrap tabular-nums",
							props.compact ? "text-lg leading-6" : "text-metric",
						)}
					>
						{value}
					</dd>
				</div>
			))}
		</dl>
	);
}
