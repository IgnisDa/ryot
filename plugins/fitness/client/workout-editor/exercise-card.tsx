import { createUuid, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { useFormatters } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	Collapse,
	formatClock,
	IconButton,
	MenuButton,
	MotionPresence,
	Notice,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useState } from "react";

import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import type { WorkoutPreferenceSettings } from "../../shared/workout-editor-preferences";
import type { WorkoutSetLot } from "../../shared/workout-set";
import { AssetArtWell } from "../asset-urls";
import { useFitnessMessages } from "../messages";
import { editSet, newWorkoutSet } from "./actions";
import {
	type DraftChange,
	isTemplateDraft,
	resolveSetRestTime,
	updateOccurrence,
} from "./draft-ops";
import { usePreviousSets } from "./previous-sets";
import type { EditorExercise } from "./queries";
import { type InvalidSet, SetGrid } from "./set-grid";
import { SetSheet } from "./set-sheet";

export type ExerciseSheet = "notes" | "history" | "replace" | "defaults" | "attachments";

export function ExerciseCard(props: {
	readonly now: number;
	readonly pro: boolean;
	readonly grouped: boolean;
	readonly disabled: boolean;
	readonly onCycle: () => void;
	readonly unavailable: boolean;
	readonly onDelete: () => void;
	readonly onDeletedSet: () => void;
	readonly countdownEnabled: boolean;
	readonly draft: WorkoutEditorDraft;
	readonly invalid: undefined | InvalidSet;
	readonly currentSetId: string | undefined;
	readonly occurrence: WorkoutEditorOccurrence;
	readonly settings: WorkoutPreferenceSettings;
	readonly onAddedSet: (setId: string) => void;
	readonly exercise: undefined | EditorExercise;
	readonly onSetChanged: (setId: string) => void;
	readonly onSheet: (sheet: ExerciseSheet) => void;
	readonly onConfirm: (set: WorkoutEditorSet) => void;
	readonly onPrevious: (set: WorkoutEditorSet) => void;
	readonly onStartExecution: (set: WorkoutEditorSet) => void;
	readonly onChange: (transform: Parameters<DraftChange>[0]) => boolean;
	readonly onManage: (kind: "reorder" | "supersets" | "bulk-delete") => void;
}) {
	const text = useFitnessMessages();
	const list = useFormatters().list();
	const { exercise, settings, onChange, occurrence, draft: editorDraft } = props;
	const { compact } = useRyotViewport();
	const disabled = props.disabled || exercise === undefined;
	const template = isTemplateDraft(editorDraft);
	const change = (transform: (occurrence: WorkoutEditorOccurrence) => WorkoutEditorOccurrence) =>
		onChange((draft) => updateOccurrence(draft, occurrence.clientId, transform));
	const patchSet = (id: string, transform: (set: WorkoutEditorSet) => WorkoutEditorSet) =>
		onChange((draft) => editSet(draft, occurrence.clientId, id, transform));
	const previous = usePreviousSets(editorDraft, occurrence);
	const [openSetId, setOpenSetId] = useState<string>();
	const openSet = occurrence.sets.find(({ clientId }) => clientId === openSetId);
	const restFor = (set: Pick<WorkoutEditorSet, "setLot" | "restChoice">) =>
		resolveSetRestTime(set, settings, exercise?.overrides ?? {});
	const inheritedRestFor = (setLot: WorkoutSetLot) =>
		restFor({ setLot, restChoice: { kind: "inherited" } });
	const normalRest = inheritedRestFor("normal");
	const name = exercise?.name ?? text("client.overlays.exercise-unavailable");
	const attachments = occurrence.images.length + occurrence.videos.length;
	const note = occurrence.notes.join("\n").trim();
	const done = occurrence.sets.filter(({ included }) => included).length;
	let progressTone = "text-text-muted";
	if (!template && done > 0) {
		progressTone = done === occurrence.sets.length ? "text-success" : "text-info";
	}
	const progress = template
		? text("client.card.planned", { count: occurrence.sets.length })
		: text("client.card.done", { done, total: occurrence.sets.length });
	const toggleCollapsed = () => change((item) => ({ ...item, isCollapsed: !item.isCollapsed }));
	const meta = [
		exercise && list.format(exercise.equipment.map(({ name: equipment }) => equipment)),
		exercise && list.format(exercise.targets.map(({ name: target }) => target)),
		progress,
		attachments > 0 ? text("client.card.attachments", { count: attachments }) : undefined,
	].filter((part) => part !== undefined && part !== "");
	if (props.unavailable) {
		return (
			<Card
				tabIndex={-1}
				role="region"
				padding="none"
				aria-label={name}
				className="grid scroll-mt-6 gap-3 p-3"
				id={`occurrence-${occurrence.clientId}`}
			>
				<div className="flex items-center gap-2.5">
					<AssetArtWell name="?" asset={undefined} className="size-10 shrink-0" />
					<div className="min-w-0 flex-1">
						<h2 className="text-[15px] font-semibold">{name}</h2>
						<p className="text-xs text-text-muted">{text("client.card.removed")}</p>
					</div>
				</div>
				<Notice
					tone="danger"
					icon={<AppIcon size={16} name="circle-alert" />}
					action={
						<Button
							size="sm"
							variant="dangerGhost"
							onClick={props.onDelete}
							disabled={props.disabled}
						>
							{text("client.card.remove-from-workout")}
						</Button>
					}
				>
					{text("client.card.blocked", { count: occurrence.sets.length })}
				</Notice>
			</Card>
		);
	}
	return (
		<Card
			tabIndex={-1}
			role="region"
			padding="none"
			aria-label={name}
			id={`occurrence-${occurrence.clientId}`}
			className="grid scroll-mt-6 gap-2 px-2.5 pt-3 pb-1.5 outline-none"
		>
			<div className="flex items-start gap-2.5 px-1">
				<AssetArtWell
					name={name}
					asset={exercise?.images?.[0]}
					className={compact ? "size-10 shrink-0" : "size-11 shrink-0"}
				/>
				<div className="min-w-0 flex-1">
					<h2 className="text-[15px] leading-5 font-semibold">
						<button
							type="button"
							onClick={toggleCollapsed}
							aria-expanded={!occurrence.isCollapsed}
							className="text-left [overflow-wrap:anywhere]"
						>
							{name}
						</button>
					</h2>
					{meta.length === 0 ? null : (
						<p className="mt-0.5 text-xs text-text-muted">{meta.join(" · ")}</p>
					)}
				</div>
				{!compact && !template ? (
					<Button size="sm" variant="ghost" onClick={() => props.onSheet("history")}>
						<AppIcon size={15} name="history" />
						{text("client.history.title")}
					</Button>
				) : null}
				<IconButton
					size="sm"
					disabled={props.disabled}
					onClick={toggleCollapsed}
					aria-expanded={!occurrence.isCollapsed}
					label={text(
						occurrence.isCollapsed ? "client.workouts.expand" : "client.workouts.collapse",
						{ name },
					)}
				>
					<AppIcon
						size={18}
						name="chevron-up"
						className={clsx(
							"transition-transform duration-200 motion-reduce:transition-none",
							progressTone,
							occurrence.isCollapsed && "rotate-180",
						)}
					/>
				</IconButton>
				<MenuButton
					label={text("client.card.actions", { name })}
					items={[
						...(compact && !template
							? [
									{
										key: "history",
										label: text("client.history.title"),
										onSelect: () => props.onSheet("history"),
									},
								]
							: []),
						{
							key: "notes",
							label: text("client.card.notes"),
							onSelect: () => props.onSheet("notes"),
						},
						{
							key: "attachments",
							onSelect: () => props.onSheet("attachments"),
							label: text("client.editor.attachments-count", { count: attachments }),
						},
						{
							disabled,
							key: "defaults",
							label: text("client.card.defaults"),
							onSelect: () => props.onSheet("defaults"),
						},
						...(props.grouped
							? [{ key: "cycle", onSelect: props.onCycle, label: text("client.card.cycle") }]
							: []),
						{
							key: "replace",
							label: text("client.card.replace"),
							disabled: props.disabled || !props.pro,
							onSelect: () => props.onSheet("replace"),
						},
						{
							key: "collapse",
							disabled: props.disabled,
							onSelect: toggleCollapsed,
							label: occurrence.isCollapsed
								? text("client.card.expand")
								: text("client.card.collapse"),
						},
						{
							key: "reorder",
							disabled: props.disabled,
							label: text("client.card.reorder"),
							onSelect: () => props.onManage("reorder"),
						},
						{
							key: "superset",
							disabled: props.disabled,
							onSelect: () => props.onManage("supersets"),
							label: props.grouped
								? text("client.card.edit-superset")
								: text("client.supersets.create"),
						},
						{
							key: "bulk-delete",
							disabled: props.disabled,
							label: text("client.editor.delete-sets"),
							onSelect: () => props.onManage("bulk-delete"),
						},
						{
							key: "remove",
							destructive: true,
							disabled: props.disabled,
							onSelect: props.onDelete,
							label: text("client.card.remove"),
						},
					]}
				/>
			</div>
			<Collapse open={!occurrence.isCollapsed}>
				<div className="grid gap-2">
					<Collapse open={note !== ""}>
						{note === "" ? null : (
							<button
								type="button"
								onClick={() => props.onSheet("notes")}
								className="mx-1 flex items-start gap-2 rounded-md bg-surface-2 px-2.5 py-2 text-left text-[13px] text-text-muted"
							>
								<AppIcon size={14} name="sticky-note" className="mt-0.5 shrink-0" />
								<span className="min-w-0 whitespace-pre-line [overflow-wrap:anywhere]">{note}</span>
							</button>
						)}
					</Collapse>
					<SetGrid
						now={props.now}
						compact={compact}
						draft={editorDraft}
						previous={previous}
						disabled={disabled}
						invalid={props.invalid}
						occurrence={occurrence}
						onComplete={props.onConfirm}
						onStart={props.onStartExecution}
						onCopyPrevious={props.onPrevious}
						currentSetId={props.currentSetId}
						countdownEnabled={props.countdownEnabled}
						onOpenSet={(set) => setOpenSetId(set.clientId)}
						onChange={(id, transform) => {
							props.onSetChanged(id);
							patchSet(id, transform);
						}}
						restSeconds={(set) => {
							const rest = restFor(set);
							return rest.kind === "resolved" ? rest.seconds : undefined;
						}}
					/>
					<div className="flex items-center gap-1">
						<Button
							size="sm"
							variant="ghost"
							disabled={disabled}
							onClick={() => {
								const setId = createUuid();
								const added = change((item) => {
									const last = item.sets.at(-1);
									return {
										...item,
										sets: [
											...item.sets,
											{
												...newWorkoutSet(setId, item.exerciseKind, last),
												included: editorDraft.mode.kind === "historical",
												setLot:
													last === undefined || last.setLot === "warm_up" ? "normal" : last.setLot,
											},
										],
									};
								});
								if (added) {
									props.onAddedSet(setId);
								}
							}}
						>
							<AppIcon size={15} name="plus" />
							{text("client.card.add-set")}
						</Button>
						<Collapse open={note === ""}>
							<Button size="sm" variant="ghost" onClick={() => props.onSheet("notes")}>
								<AppIcon size={14} name="pencil" />
								{text("property.note")}
							</Button>
						</Collapse>
						<span className="flex-1" />
						{normalRest.kind === "resolved" ? (
							<span className="pr-2 text-xs text-text-subtle tabular-nums">
								{text("client.card.rest", { time: formatClock(normalRest.seconds) })}
							</span>
						) : null}
					</div>
				</div>
			</Collapse>
			<MotionPresence>
				{openSet === undefined ? null : (
					<SetSheet
						set={openSet}
						pro={props.pro}
						key="set-options"
						exerciseName={name}
						draft={editorDraft}
						disabled={disabled}
						occurrence={occurrence}
						onClose={() => setOpenSetId(undefined)}
						previous={previous.get(openSet.clientId)}
						onCopyPrevious={() => {
							props.onPrevious(openSet);
							setOpenSetId(undefined);
						}}
						onChange={(transform) => {
							props.onSetChanged(openSet.clientId);
							patchSet(openSet.clientId, transform);
						}}
						inheritedRestSeconds={(() => {
							const rest = inheritedRestFor(openSet.setLot);
							return rest.kind === "resolved" ? rest.seconds : 0;
						})()}
						onDelete={() => {
							const deleted = change((item) =>
								item.sets.some(({ clientId }) => clientId === openSet.clientId)
									? {
											...item,
											sets: item.sets.filter(({ clientId }) => clientId !== openSet.clientId),
										}
									: item,
							);
							if (deleted) {
								props.onDeletedSet();
							}
							setOpenSetId(undefined);
						}}
					/>
				)}
			</MotionPresence>
		</Card>
	);
}
