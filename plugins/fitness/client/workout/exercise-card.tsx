import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { Card } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";

import { supersetColor } from "../../shared/superset-colors";
import { durationDisplayUnit } from "../../shared/workout-units";
import { AssetArtWell } from "../asset-urls";
import { supersetColorVariable } from "../group-colors";
import { WorkoutMediaViewer } from "../media-viewer";
import { setLabels, setLots } from "../set-lots";
import { ComputedResults, useComputedResultsStatus } from "../workout-processing";
import {
	type CardGroup,
	type ExerciseCard,
	personalBestLabels,
	type WorkoutSet,
} from "./details-model";
import {
	formatClock,
	formatExerciseMeta,
	formatMeasure,
	formatNumber,
	formatSetMain,
	formatShortDate,
	formatSignedMeasure,
} from "./format";

function ExerciseArtwork(props: { readonly card: ExerciseCard; readonly compact: boolean }) {
	return (
		<AssetArtWell
			name={props.card.exercise.name}
			asset={props.card.exercise.images?.[0]}
			className={clsx("shrink-0", props.compact ? "size-11" : "size-14")}
		/>
	);
}

function RecordBadges(props: { readonly set: WorkoutSet }) {
	return (
		<ComputedResults>
			<span className="flex flex-wrap gap-1">
				{(props.set.personalBests ?? []).map((record) => (
					<span
						key={record}
						className="rounded-pill bg-accent-soft px-2 py-0.5 font-ui font-semibold text-[12px] text-accent-text"
					>
						{personalBestLabels[record]}
					</span>
				))}
			</span>
		</ComputedResults>
	);
}

const wideColumns = (showOneRm: boolean, showRpe: boolean) => {
	if (showOneRm && showRpe) {
		return "grid-cols-[2.5rem_minmax(0,1.3fr)_minmax(0,0.9fr)_3rem_3.5rem_minmax(0,1.3fr)]";
	}
	if (showOneRm) {
		return "grid-cols-[2.5rem_minmax(0,1.3fr)_minmax(0,0.9fr)_3.5rem_minmax(0,1.3fr)]";
	}
	return showRpe
		? "grid-cols-[2.5rem_minmax(0,1.3fr)_3rem_3.5rem_minmax(0,1.3fr)]"
		: "grid-cols-[2.5rem_minmax(0,1.3fr)_3.5rem_minmax(0,1.3fr)]";
};

function SetTable(props: {
	readonly card: ExerciseCard;
	readonly compact: boolean;
	readonly imperial: boolean;
}) {
	const { card, compact } = props;
	const processing = useComputedResultsStatus();
	const labels = setLabels(card.sets.map((set) => set.setLot));
	const showRpe = card.sets.some((set) => set.rpe !== null);
	const showOneRm = card.kind === "reps_and_weight" && !processing.pending && !processing.failed;
	const columns = compact ? "grid-cols-[2rem_minmax(0,1fr)_auto]" : wideColumns(showOneRm, showRpe);
	return (
		<div role="table" className="font-ui" aria-label={`Sets for ${card.exercise.name}`}>
			{compact ? null : (
				<div
					role="row"
					className={clsx(
						"grid gap-2 border-t border-border px-4 py-2 text-[11px] font-semibold tracking-wide text-text-muted uppercase",
						columns,
					)}
				>
					<span role="columnheader">Set</span>
					<span role="columnheader">Performed</span>
					{showOneRm ? <span role="columnheader">Est. 1RM</span> : null}
					{showRpe ? <span role="columnheader">RPE</span> : null}
					<span role="columnheader">Rest</span>
					<span role="columnheader">Records</span>
				</div>
			)}
			{card.sets.map((set, index) => {
				const hasRecords =
					(set.personalBests?.length ?? 0) > 0 && !processing.pending && !processing.failed;
				const lot = setLots[set.setLot ?? "normal"];
				const secondary = [
					showOneRm && set.oneRm !== null
						? `${formatMeasure(set.oneRm, "kg", props.imperial)} 1RM`
						: null,
					set.rpe === null ? null : `RPE ${formatNumber(set.rpe)}`,
				].filter((part) => part !== null);
				return (
					<div
						role="row"
						key={set.id}
						data-record={hasRecords}
						className={clsx(
							"grid items-center gap-x-2 gap-y-0.5 border-t border-border px-4 py-2.5 text-[15px]",
							columns,
							hasRecords && "bg-accent-soft/40",
						)}
					>
						<span
							role="cell"
							title={lot.name}
							aria-label={`${lot.name} ${labels[index]}`}
							className={clsx(
								"flex size-6.5 items-center justify-center rounded-pill bg-surface-2 text-[13px] font-semibold",
								lot.tone ?? "text-text-muted",
							)}
						>
							{labels[index]}
						</span>
						<span role="cell" className="font-medium text-text">
							{formatSetMain(
								card.kind,
								set,
								props.imperial,
								durationDisplayUnit(card.exercise.defaultDurationUnit),
							)}
							{compact && secondary.length > 0 ? (
								<span className="font-normal text-[13px] text-text-muted">
									{` · ${secondary.join(" · ")}`}
								</span>
							) : null}
						</span>
						{compact ? null : (
							<>
								{showOneRm ? (
									<span role="cell" className="text-text-muted">
										{set.oneRm === null ? "—" : formatMeasure(set.oneRm, "kg", props.imperial)}
									</span>
								) : null}
								{showRpe ? (
									<span role="cell" className="font-medium text-text">
										{set.rpe === null ? "—" : formatNumber(set.rpe)}
									</span>
								) : null}
								<span role="cell" className="text-[14px] text-text-muted">
									{set.restTime === null ? "—" : formatClock(set.restTime)}
								</span>
							</>
						)}
						<span role="cell">
							<RecordBadges set={set} />
						</span>
						{set.note === null ? null : (
							<span className="col-start-2 col-end-[-1] text-[13px] text-text-muted italic">
								“{set.note}”
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
}

function RecordStatusNote(props: { readonly card: ExerciseCard }) {
	if (props.card.recordStatus === "ready") {
		return null;
	}
	return (
		<p role="status" className="px-4 pb-2 font-ui text-[13px] text-text-muted">
			{props.card.recordStatus === "failed"
				? "Records couldn't be updated for this exercise."
				: "Updating records…"}
		</p>
	);
}

export function ExerciseCardView(props: {
	readonly groupColor?: string;
	readonly imperial: boolean;
	readonly compact: boolean;
	readonly card: ExerciseCard;
	readonly workoutStartedAt: string | null;
}) {
	const { card, compact } = props;
	const meta = formatExerciseMeta({
		targets: card.exercise.targets.items,
		equipment: card.exercise.equipment.items,
	});
	return (
		<Card
			padding="none"
			data-exercise-id={card.exercise.id}
			className="min-w-0 overflow-hidden"
			groupColor={props.groupColor === undefined ? undefined : supersetColor(props.groupColor)}
		>
			<div className="flex items-start gap-3 px-4 pt-4 pb-3">
				<PluginLink
					aria-label={`Open ${card.exercise.name}`}
					to={{ kind: "entity", entityId: card.exercise.id }}
				>
					<ExerciseArtwork card={card} compact={compact} />
				</PluginLink>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="flex min-w-0 items-center gap-2">
						{card.supersetTag === null ? null : (
							<span
								className="shrink-0 rounded-sm px-1.5 py-0.5 font-ui font-bold text-[12px]"
								style={
									props.groupColor === undefined
										? undefined
										: {
												color: supersetColorVariable(props.groupColor),
												backgroundColor: supersetColorVariable(props.groupColor, { soft: true }),
											}
								}
							>
								{card.supersetTag}
							</span>
						)}
						<PluginLink className="min-w-0" to={{ kind: "entity", entityId: card.exercise.id }}>
							<h3 className="font-ui font-semibold text-[16px] text-text">{card.exercise.name}</h3>
						</PluginLink>
					</div>
					{meta === "" ? null : <p className="font-ui text-[13px] text-text-muted">{meta}</p>}
				</div>
				<div className="flex shrink-0 flex-col items-end gap-0.5 text-right font-ui">
					{card.total === null ? null : (
						<span className="font-semibold text-[15px] text-text">
							{formatMeasure(card.total.value, card.total.unit, props.imperial)}
						</span>
					)}
					{card.comparison === null ? null : (
						<span
							className={clsx(
								"text-[13px]",
								card.comparison.delta > 0 ? "text-success" : "text-text-muted",
							)}
						>
							{formatSignedMeasure(card.comparison.delta, card.comparison.unit, props.imperial)}
							{card.comparison.delta === 0
								? ""
								: ` vs ${formatShortDate(card.comparison.previousStartedAt, props.workoutStartedAt)}`}
						</span>
					)}
				</div>
			</div>
			{card.notes.map((note) => (
				<p
					key={note}
					className="mx-4 mb-3 rounded-md bg-surface-2 px-3 py-2 font-ui text-[14px] text-text-muted"
				>
					{note}
				</p>
			))}
			<RecordStatusNote card={card} />
			<SetTable card={card} compact={compact} imperial={props.imperial} />
			{card.media ? (
				<WorkoutMediaViewer
					label={card.exercise.name}
					images={card.media.images}
					videos={card.media.videos}
				/>
			) : null}
		</Card>
	);
}

export function ExerciseGroups(props: {
	readonly imperial: boolean;
	readonly compact: boolean;
	readonly groups: readonly CardGroup[];
	readonly workoutStartedAt: string | null;
}) {
	return (
		<div className={clsx("grid items-start gap-4", !props.compact && "grid-cols-2")}>
			{props.groups.map((group) =>
				group.kind === "single" ? (
					<ExerciseCardView
						card={group.card}
						key={group.card.key}
						compact={props.compact}
						imperial={props.imperial}
						workoutStartedAt={props.workoutStartedAt}
					/>
				) : (
					<section
						className="col-span-full grid gap-3"
						aria-label={`Superset ${group.label}`}
						key={group.cards.map((card) => card.key).join("+")}
					>
						<div className="flex items-center gap-3 font-ui">
							<span
								className="rounded-pill px-2.5 py-1 font-semibold text-[13px]"
								style={{
									color: supersetColorVariable(group.color),
									backgroundColor: supersetColorVariable(group.color, { soft: true }),
								}}
							>
								Superset {group.label}
							</span>
							<span className="text-[14px] text-text-muted">
								Alternate {group.cards.map((card) => card.supersetTag).join(" and ")}
							</span>
						</div>
						<div className={clsx("grid items-start gap-4", !props.compact && "grid-cols-2")}>
							{group.cards.map((card) => (
								<ExerciseCardView
									card={card}
									key={card.key}
									compact={props.compact}
									groupColor={group.color}
									imperial={props.imperial}
									workoutStartedAt={props.workoutStartedAt}
								/>
							))}
						</div>
					</section>
				),
			)}
		</div>
	);
}
