import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { includedWorkoutOccurrences } from "../../shared/workout-editor-transformations";
import {
	kilogramsToPounds,
	kilometersToMiles,
	milesToKilometers,
	poundsToKilograms,
} from "../../shared/workout-units";
import { formatEditorSeconds } from "./clocks";

const quantity = (text: string | undefined) =>
	text !== undefined && text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= 0
		? Number(text)
		: 0;

export function EditorSummary(props: {
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
	const active =
		draft.activeDuration === undefined
			? "Unknown"
			: formatEditorSeconds(
					draft.activeDuration +
						(draft.activeDurationStartedAt === undefined
							? 0
							: Math.max(0, (props.now - Date.parse(draft.activeDurationStartedAt)) / 1000)),
				);
	const template = draft.mode.kind === "template-create" || draft.mode.kind === "template-edit";
	const stats = [
		{
			label: template ? "Planned sets" : "Included sets",
			value: String(included.reduce((count, { sets }) => count + sets.length, 0)),
		},
		{
			label: template ? "Exercises" : "Active duration",
			value: template ? String(draft.occurrences.length) : active,
		},
		{
			label: "Volume",
			value: `${(props.imperial ? kilogramsToPounds(volumeKg) : volumeKg).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${props.imperial ? "lb" : "kg"}`,
		},
		{ label: "Repetitions", value: reps.toLocaleString() },
	];
	return (
		<div className="rounded-xl border border-border bg-surface-2 p-4">
			<dl className={`grid gap-4 ${props.compact ? "grid-cols-2" : "grid-cols-4"}`}>
				{stats.map(({ label, value }) => (
					<div key={label}>
						<dt className="text-xs font-medium uppercase tracking-wider text-text-subtle">
							{label}
						</dt>
						<dd className="mt-1 text-xl font-semibold tabular-nums text-text">{value}</dd>
					</div>
				))}
			</dl>
			{distanceKm > 0 ? (
				<p className="mt-3 text-sm text-text-subtle">
					Distance:{" "}
					{(props.imperial ? kilometersToMiles(distanceKm) : distanceKm).toLocaleString(undefined, {
						maximumFractionDigits: 2,
					})}{" "}
					{props.imperial ? "mi" : "km"}
				</p>
			) : null}
		</div>
	);
}
