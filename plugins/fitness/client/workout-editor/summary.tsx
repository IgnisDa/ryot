import clsx from "clsx";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { includedWorkoutOccurrences } from "../../shared/workout-editor-transformations";
import {
	kilogramsToPounds,
	kilometersToMiles,
	milesToKilometers,
	poundsToKilograms,
} from "../../shared/workout-units";
import { formatEditorSeconds } from "./clock";
import { isTemplateDraft } from "./draft-ops";
import { activeDurationSeconds } from "./timers";

const quantity = (text: string | undefined) =>
	text !== undefined && text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= 0
		? Number(text)
		: 0;

export function EditorStats(props: {
	readonly draft: WorkoutEditorDraft;
	readonly now: number;
	readonly compact: boolean;
	readonly imperial: boolean;
}) {
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
	const stats: { readonly label: string; readonly value: string; readonly unit?: string }[] =
		template
			? [
					{ label: "Exercises", value: String(draft.occurrences.length) },
					{ value: String(total), label: "Planned sets" },
				]
			: [
					{
						label: draft.mode.kind === "historical" ? "Active" : "Duration",
						value: active === undefined ? "Unknown" : formatEditorSeconds(active),
					},
					{ label: "Sets", unit: `/${total}`, value: String(done) },
					{
						label: "Volume",
						unit: props.imperial ? " lb" : " kg",
						value: (props.imperial ? kilogramsToPounds(volumeKg) : volumeKg).toLocaleString(
							undefined,
							{ maximumFractionDigits: 1 },
						),
					},
					{ label: "Reps", value: reps.toLocaleString() },
					...(distanceKm > 0
						? [
								{
									label: "Distance",
									unit: props.imperial ? " mi" : " km",
									value: (props.imperial
										? kilometersToMiles(distanceKm)
										: distanceKm
									).toLocaleString(undefined, { maximumFractionDigits: 2 }),
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
			{stats.map(({ unit, label, value }) => (
				<div key={label} className="grid min-w-0 content-start gap-px">
					<dt className="text-xs text-text-muted">{label}</dt>
					<dd
						className={clsx(
							"font-semibold whitespace-nowrap tabular-nums",
							props.compact ? "text-lg leading-6" : "text-metric",
						)}
					>
						{value}
						{unit === undefined ? null : (
							<small className="text-xs font-medium text-text-subtle">{unit}</small>
						)}
					</dd>
				</div>
			))}
		</dl>
	);
}
