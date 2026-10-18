import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	Dialog,
	Checkbox,
	EmptyState,
	IconButton,
	MotionPresence,
	Notice,
	RadioGroup,
	ReorderableList,
	Skeleton,
	useMotionPreference,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "react";

import { supersetColor, supersetColors, type SupersetColor } from "../../shared/superset-colors";
import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type {
	WorkoutHistoryResult,
	WorkoutHistorySetResult,
} from "../../shared/workout-history-recipes";
import { supersetColorVariable, supersetSoftColorVariable } from "../group-colors";
import { removeWorkoutItems } from "./actions";
import { editorHistoryQuery, readHistorySets } from "./queries";
import { supersetNames } from "./superset-group";
import { ConfirmDialog } from "./workout-sheets";

const historySetsQuery = createRyotQuery<
	{ readonly workoutId: string; readonly exerciseId: string },
	WorkoutHistorySetResult["items"]
>(({ input, client }) => readHistorySets(client, input.workoutId, input.exerciseId));

const historySetText = (set: WorkoutHistorySetResult["items"][number]) =>
	[
		set.weight === null ? null : `${set.weight} kg`,
		set.reps === null ? null : `${set.reps} reps`,
		set.duration === null ? null : `${set.duration} s`,
		set.distance === null ? null : `${set.distance} km`,
		set.rpe === null ? null : `RPE ${set.rpe}`,
		set.note ? `“${set.note}”` : null,
	]
		.filter(Boolean)
		.join(" · ");

const scrollIntoView = (element: HTMLElement | null, reduced: boolean) => {
	if (element !== null && element.getBoundingClientRect().height > 0) {
		element.scrollIntoView({ block: "nearest", behavior: reduced ? "instant" : "smooth" });
	}
};

function HistorySession(props: {
	readonly session: WorkoutHistoryResult["items"][number];
	readonly exerciseId: string;
	readonly onAppend: (sets: WorkoutHistorySetResult["items"]) => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const result = useRyotQuery(historySetsQuery, {
		workoutId: props.session.id,
		exerciseId: props.exerciseId,
	});
	return (
		<Card className="grid gap-2">
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<h3 className="font-semibold [overflow-wrap:anywhere]">{props.session.name}</h3>
					<p className="text-xs text-text-muted">
						{new Date(props.session.startedAt).toLocaleString()}
					</p>
				</div>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => setConfirming(true)}
					disabled={result.data === undefined}
				>
					<AppIcon size={14} name="plus" />
					Add sets
				</Button>
			</div>
			{props.session.comment ? (
				<p className="text-sm text-text-muted">{props.session.comment}</p>
			) : null}
			{result.data === undefined && !result.isError ? (
				<div role="status" className="grid gap-1.5" aria-label="Loading sets">
					<Skeleton className="h-4 w-2/3" />
					<Skeleton className="h-4 w-1/2" />
				</div>
			) : null}
			{result.data === undefined ? null : (
				<ol className="grid list-decimal gap-0.5 pl-5 text-sm tabular-nums">
					{result.data.map((set) => (
						<li key={set.id}>{historySetText(set)}</li>
					))}
				</ol>
			)}
			{result.isError ? (
				<Notice
					tone="danger"
					icon={<AppIcon size={16} name="circle-alert" />}
					action={
						<Button size="sm" variant="secondary" onClick={result.refetch}>
							Retry history sets
						</Button>
					}
				>
					History sets could not be loaded.
				</Notice>
			) : null}
			<MotionPresence>
				{confirming ? (
					<ConfirmDialog
						key="append-history"
						cancelLabel="Cancel"
						confirmLabel="Add sets"
						disabled={result.data === undefined}
						onClose={() => setConfirming(false)}
						title={`Add sets from ${props.session.name}?`}
						description={`${result.data?.length ?? 0} ${result.data?.length === 1 ? "set" : "sets"} from this session will be added to the exercise.`}
						onConfirm={() => {
							if (result.data !== undefined) {
								props.onAppend(result.data);
							}
							setConfirming(false);
						}}
					/>
				) : null}
			</MotionPresence>
		</Card>
	);
}

export function HistoryRequiresPro(props: {
	readonly compact: boolean;
	readonly safeAreaBottom: number;
	readonly exerciseName: string;
	readonly onClose: () => void;
}) {
	return (
		<Dialog
			onClose={props.onClose}
			title="Exercise history"
			closeLabel="Close history"
			description={props.exerciseName}
			safeAreaBottom={props.safeAreaBottom}
			closeIcon={<AppIcon name="x" size={18} />}
			placement={props.compact ? "sheet" : "center"}
			footer={<Button onClick={props.onClose}>Got it</Button>}
		>
			<Notice
				tone="info"
				icon={<AppIcon size={16} name="info" />}
				title="History in the logger requires Pro"
			>
				Tap a value in the Previous column to copy last session's numbers. New exercises are still
				prefilled automatically.
			</Notice>
		</Dialog>
	);
}

export function HistoryOverlay(props: {
	readonly compact: boolean;
	readonly safeAreaBottom: number;
	readonly exerciseId: string;
	readonly exerciseName: string;
	readonly beforeStartedAt: string | undefined;
	readonly excludeWorkoutId: string | undefined;
	readonly onClose: () => void;
	readonly onAppend: (sets: WorkoutHistorySetResult["items"]) => void;
}) {
	const [cursors, setCursors] = useState<readonly string[]>([]);
	const after = cursors.at(-1);
	const [loaded, setLoaded] = useState<{
		readonly result: WorkoutHistoryResult | undefined;
		readonly sessions: WorkoutHistoryResult["items"];
	}>({ sessions: [], result: undefined });
	const result = useRyotQuery(editorHistoryQuery, {
		after,
		exerciseId: props.exerciseId,
		beforeStartedAt: props.beforeStartedAt,
		excludeWorkoutId: props.excludeWorkoutId,
	});
	if (result.data !== undefined && result.data !== loaded.result) {
		setLoaded({
			result: result.data,
			sessions: [
				...new Map(
					[...loaded.sessions, ...result.data.items].map((session) => [session.id, session]),
				).values(),
			],
		});
	}
	const sessions = loaded.sessions;
	const nextCursor = result.data?.pageInfo.nextCursor;
	const invalidCursor =
		result.data?.pageInfo.hasMore === true &&
		(nextCursor === null || nextCursor === undefined || cursors.includes(nextCursor));
	return (
		<Dialog
			title="History"
			onClose={props.onClose}
			closeLabel="Close history"
			description={props.exerciseName}
			safeAreaBottom={props.safeAreaBottom}
			closeIcon={<AppIcon name="x" size={18} />}
			placement={props.compact ? "sheet" : "side"}
			footer={
				result.data?.pageInfo.hasMore ? (
					<Button
						className="w-full"
						variant="secondary"
						disabled={result.isFetching || invalidCursor}
						onClick={() => {
							const next = result.data?.pageInfo.nextCursor;
							if (next !== null && next !== undefined && next !== after) {
								setCursors((previous) => [...previous, next]);
							}
						}}
					>
						More sessions
					</Button>
				) : undefined
			}
		>
			<div className="grid gap-3">
				{sessions.map((session) => (
					<HistorySession
						key={session.id}
						session={session}
						onAppend={props.onAppend}
						exerciseId={props.exerciseId}
					/>
				))}
				{sessions.length === 0 && result.isSuccess ? (
					<EmptyState
						title="No earlier sessions"
						icon={<AppIcon size={20} name="history" />}
						description="Sets you log for this exercise show up here next time."
					/>
				) : null}
				{result.isPending ? (
					<div role="status" className="grid gap-3" aria-label="Loading history">
						<Skeleton className="h-24" />
						<Skeleton className="h-24" />
					</div>
				) : null}
				{result.isError ? (
					<Notice
						tone="danger"
						icon={<AppIcon size={16} name="circle-alert" />}
						action={
							<Button size="sm" variant="secondary" onClick={result.refetch}>
								Retry history
							</Button>
						}
					>
						History could not be loaded.
					</Notice>
				) : null}
				{invalidCursor ? (
					<Notice tone="danger" icon={<AppIcon size={16} name="circle-alert" />}>
						History pagination could not continue. Retry loading this page.
					</Notice>
				) : null}
			</div>
		</Dialog>
	);
}

type DraftOverlayProps = {
	readonly compact: boolean;
	readonly safeAreaBottom: number;
	readonly draft: WorkoutEditorDraft;
	readonly names: ReadonlyMap<string, string>;
	readonly initialOccurrenceId?: string | undefined;
	readonly onChange: (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => void;
	readonly onClose: () => void;
	readonly onMoved?: (occurrenceId: string) => void;
};

const sectionHeading = "text-[11px] font-semibold tracking-wider text-text-subtle uppercase";

export function ReorderOverlay(props: DraftOverlayProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const initialOccurrenceRef = useRef<HTMLDivElement>(null);
	const reduced = useMotionPreference();
	useLayoutEffect(() => {
		if (props.initialOccurrenceId !== undefined) {
			scrollIntoView(initialOccurrenceRef.current, reduced);
		}
	}, [props.initialOccurrenceId, reduced]);
	const groups = supersetNames(props.draft);
	return (
		<Dialog
			onClose={props.onClose}
			title="Reorder exercises"
			closeLabel="Close reorder"
			safeAreaBottom={props.safeAreaBottom}
			description="Changes apply right away."
			closeIcon={<AppIcon name="x" size={18} />}
			placement={props.compact ? "sheet" : "center"}
			footer={<Button onClick={props.onClose}>Done</Button>}
		>
			<div ref={scrollRef} className="max-h-[60vh] overflow-y-auto">
				<ReorderableList
					itemHeight={56}
					scrollRef={scrollRef}
					label="Exercise order"
					items={props.draft.occurrences}
					itemKey={(item) => item.clientId}
					handleIcon={<AppIcon size={18} name="grip-vertical" />}
					itemLabel={(item) => props.names.get(item.exerciseId) ?? "Unavailable exercise"}
					onReorder={(from, to) => {
						const item = props.draft.occurrences[from];
						if (item === undefined) {
							return;
						}
						props.onChange((draft) => {
							const occurrences = [...draft.occurrences];
							const reordered = occurrences.splice(from, 1)[0];
							if (reordered === undefined) {
								return draft;
							}
							occurrences.splice(to, 0, reordered);
							return { ...draft, occurrences };
						});
						props.onMoved?.(item.clientId);
					}}
					renderItem={({ item, handle }) => {
						const completedSets = item.sets.filter(({ included }) => included).length;
						let progress = "Not started";
						if (completedSets > 0) {
							progress = completedSets === item.sets.length ? "Complete" : "In progress";
						}
						const group = props.draft.supersets.find(({ occurrenceIds }) =>
							occurrenceIds.includes(item.clientId),
						);
						return (
							<div
								ref={item.clientId === props.initialOccurrenceId ? initialOccurrenceRef : undefined}
								className={clsx(
									"flex h-14 items-center gap-3 border-b border-border",
									item.clientId === props.initialOccurrenceId && "rounded-md bg-accent-soft",
								)}
							>
								{handle}
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-semibold">
										{props.names.get(item.exerciseId) ?? "Unavailable exercise"}
									</p>
									<p className="text-xs text-text-muted">{progress}</p>
								</div>
								{group === undefined ? null : (
									<span
										className="rounded-pill px-2 py-0.5 text-xs font-semibold"
										style={{
											color: supersetColorVariable(group.color),
											backgroundColor: supersetSoftColorVariable(group.color),
										}}
									>
										{groups.get(group.clientId)}
									</span>
								)}
							</div>
						);
					}}
				/>
			</div>
		</Dialog>
	);
}

const toggleSelection = (values: readonly string[], id: string) =>
	values.includes(id) ? values.filter((value) => value !== id) : [...values, id];

export function BulkDeleteOverlay(props: DraftOverlayProps) {
	const [occurrences, setOccurrences] = useState<readonly string[]>(() =>
		props.initialOccurrenceId === undefined ? [] : [props.initialOccurrenceId],
	);
	const [sets, setSets] = useState<readonly string[]>([]);
	const initialOccurrenceRef = useRef<HTMLFieldSetElement>(null);
	const [confirming, setConfirming] = useState(false);
	const reduced = useMotionPreference();
	useLayoutEffect(() => {
		if (props.initialOccurrenceId !== undefined) {
			scrollIntoView(initialOccurrenceRef.current, reduced);
		}
	}, [props.initialOccurrenceId, reduced]);
	const selectedExercises = props.draft.occurrences.filter(({ clientId }) =>
		occurrences.includes(clientId),
	);
	const selectedSetCount = props.draft.occurrences
		.filter(({ clientId }) => !occurrences.includes(clientId))
		.flatMap(({ sets: occurrenceSets }) => occurrenceSets)
		.filter(({ clientId }) => sets.includes(clientId)).length;
	const count = selectedExercises.length + selectedSetCount;
	return (
		<Dialog
			onClose={props.onClose}
			closeLabel="Cancel bulk delete"
			title="Delete exercises or sets"
			safeAreaBottom={props.safeAreaBottom}
			closeIcon={<AppIcon name="x" size={18} />}
			placement={props.compact ? "sheet" : "center"}
			footer={
				<>
					<Button variant="secondary" onClick={props.onClose}>
						Cancel
					</Button>
					<Button variant="danger" disabled={count === 0} onClick={() => setConfirming(true)}>
						{count === 0 ? "Delete selected" : `Delete ${count} selected`}
					</Button>
				</>
			}
		>
			<div className="grid gap-3">
				{props.draft.occurrences.map((occurrence) => {
					const name = props.names.get(occurrence.exerciseId) ?? "Unavailable exercise";
					const whole = occurrences.includes(occurrence.clientId);
					return (
						<fieldset
							key={occurrence.clientId}
							className="grid min-w-0 gap-1 rounded-lg border border-border-card bg-surface px-3 py-2"
							ref={
								occurrence.clientId === props.initialOccurrenceId ? initialOccurrenceRef : undefined
							}
						>
							<legend className="sr-only">{name}</legend>
							<Checkbox
								checked={whole}
								onChange={() => setOccurrences(toggleSelection(occurrences, occurrence.clientId))}
								label={
									<span className="min-w-0">
										<span className="font-semibold [overflow-wrap:anywhere]">{name}</span>
										<span className="text-text-muted"> · whole exercise</span>
									</span>
								}
							/>
							{occurrence.sets.length === 0 ? null : (
								<div className="flex flex-wrap gap-x-4 pl-7">
									{occurrence.sets.map((set, setIndex) => (
										<Checkbox
											disabled={whole}
											key={set.clientId}
											label={`Set ${setIndex + 1}`}
											checked={whole || sets.includes(set.clientId)}
											onChange={() => setSets(toggleSelection(sets, set.clientId))}
										/>
									))}
								</div>
							)}
						</fieldset>
					);
				})}
			</div>
			<MotionPresence>
				{confirming ? (
					<ConfirmDialog
						cancelLabel="Cancel"
						disabled={count === 0}
						key="bulk-delete-confirm"
						title="Delete selected items?"
						confirmLabel="Delete selected"
						onClose={() => setConfirming(false)}
						onConfirm={() => {
							props.onChange((draft) => removeWorkoutItems(draft, occurrences, sets));
							setConfirming(false);
							props.onClose();
						}}
						description={`Delete ${selectedExercises.length} ${selectedExercises.length === 1 ? "exercise" : "exercises"} and ${selectedSetCount} individual ${selectedSetCount === 1 ? "set" : "sets"}?`}
					/>
				) : null}
			</MotionPresence>
		</Dialog>
	);
}

export function SupersetOverlay(props: DraftOverlayProps) {
	const initialOccurrenceId = props.initialOccurrenceId;
	const initialGroup =
		initialOccurrenceId === undefined
			? undefined
			: props.draft.supersets.find(({ occurrenceIds }) =>
					occurrenceIds.includes(initialOccurrenceId),
				);
	const [editing, setEditing] = useState<string | undefined>(() => initialGroup?.clientId);
	const [selected, setSelected] = useState<readonly string[]>(() =>
		initialOccurrenceId === undefined ? [] : (initialGroup?.occurrenceIds ?? [initialOccurrenceId]),
	);
	const [color, setColor] = useState<SupersetColor>(() =>
		initialGroup === undefined ? "blue" : supersetColor(initialGroup.color),
	);
	const [deleting, setDeleting] = useState<string>();
	const groups = supersetNames(props.draft);
	const memberNames = (occurrenceIds: readonly string[]) =>
		occurrenceIds
			.map((id) => {
				const occurrence = props.draft.occurrences.find(({ clientId }) => clientId === id);
				return occurrence === undefined ? "" : props.names.get(occurrence.exerciseId);
			})
			.join(" + ");
	return (
		<Dialog
			title="Supersets"
			onClose={props.onClose}
			closeLabel="Close supersets"
			safeAreaBottom={props.safeAreaBottom}
			closeIcon={<AppIcon name="x" size={18} />}
			placement={props.compact ? "sheet" : "center"}
			description="Group exercises you alternate between."
			footer={
				<>
					<Button variant="secondary" onClick={props.onClose}>
						Done
					</Button>
					<Button
						disabled={selected.length < 2}
						onClick={() => {
							props.onChange((draft) => ({
								...draft,
								supersets: [
									...draft.supersets
										.filter(({ clientId }) => clientId !== editing)
										.flatMap((group) => {
											const occurrenceIds = group.occurrenceIds.filter(
												(id) => !selected.includes(id),
											);
											return occurrenceIds.length < 2 ? [] : [{ ...group, occurrenceIds }];
										}),
									{ color, occurrenceIds: selected, clientId: editing ?? crypto.randomUUID() },
								],
							}));
							setEditing(undefined);
							setSelected([]);
						}}
					>
						{editing === undefined ? "Create superset" : "Save superset"}
					</Button>
				</>
			}
		>
			<div className="grid gap-5">
				{props.draft.supersets.length === 0 ? null : (
					<section className="grid gap-2">
						<h3 className={sectionHeading}>Current</h3>
						{props.draft.supersets.map((group) => {
							const name = groups.get(group.clientId) ?? "Superset";
							return (
								<Card
									padding="none"
									key={group.clientId}
									className="flex items-center gap-2.5 px-3 py-2.5"
								>
									<span
										aria-hidden="true"
										className="size-2.5 shrink-0 rounded-[3px]"
										style={{ backgroundColor: supersetColorVariable(group.color) }}
									/>
									<div className="min-w-0 flex-1 text-sm">
										<p className="font-semibold">{name}</p>
										<p className="text-text-muted [overflow-wrap:anywhere]">
											{memberNames(group.occurrenceIds)}
										</p>
									</div>
									<Button
										size="sm"
										variant="ghost"
										aria-label={`Edit ${name}`}
										onClick={() => {
											setEditing(group.clientId);
											setSelected(group.occurrenceIds);
											setColor(supersetColor(group.color));
										}}
									>
										Edit
									</Button>
									<IconButton
										size="sm"
										tone="danger"
										label={`Delete ${name}`}
										onClick={() => setDeleting(group.clientId)}
									>
										<AppIcon size={16} name="trash-2" />
									</IconButton>
								</Card>
							);
						})}
					</section>
				)}
				<section className="grid gap-2">
					<h3 className={sectionHeading}>
						{editing === undefined
							? "New superset · pick two or more"
							: `Editing ${groups.get(editing) ?? "superset"}`}
					</h3>
					<div className="grid divide-y divide-border rounded-lg border border-border-card bg-surface px-3">
						{props.draft.occurrences.map((occurrence) => {
							const other = props.draft.supersets.find(
								({ clientId, occurrenceIds }) =>
									clientId !== editing && occurrenceIds.includes(occurrence.clientId),
							);
							return (
								<Checkbox
									className="py-2"
									key={occurrence.clientId}
									checked={selected.includes(occurrence.clientId)}
									onChange={() => setSelected(toggleSelection(selected, occurrence.clientId))}
									label={
										<span className="min-w-0 [overflow-wrap:anywhere]">
											{props.names.get(occurrence.exerciseId) ?? "Unavailable exercise"}
											{other === undefined ? null : (
												<span className="text-text-subtle"> · in {groups.get(other.clientId)}</span>
											)}
										</span>
									}
								/>
							);
						})}
					</div>
					<div className="grid gap-1.5">
						<span className="text-[13px] font-medium">Color</span>
						<RadioGroup
							value={color}
							onChange={setColor}
							label="Superset color"
							className="flex flex-wrap gap-2"
							options={supersetColors.map((value) => ({
								value,
								label: `${value[0]?.toUpperCase()}${value.slice(1)}`,
							}))}
							renderOption={(option, checked) => ({
								className: clsx(
									"grid size-10 place-items-center rounded-md border-2 pointer-coarse:size-11",
									checked ? "border-text" : "border-transparent",
								),
								content: (
									<span
										aria-hidden="true"
										className="grid size-full place-items-center rounded-sm"
										style={{ backgroundColor: supersetSoftColorVariable(option.value) }}
									>
										<span
											className="size-4.5 rounded-[5px]"
											style={{ backgroundColor: supersetColorVariable(option.value) }}
										/>
									</span>
								),
							})}
						/>
					</div>
					<p className="text-xs text-text-muted">
						Moving an exercise here takes it out of its current superset. Supersets left with one
						exercise are removed.
					</p>
				</section>
			</div>
			<MotionPresence>
				{deleting === undefined ? null : (
					<ConfirmDialog
						cancelLabel="Cancel"
						key="superset-delete-confirm"
						confirmLabel="Delete superset"
						onClose={() => setDeleting(undefined)}
						title={`Delete ${groups.get(deleting) ?? "superset"}?`}
						description="The superset will be removed. Its exercises and sets will remain in the workout."
						onConfirm={() => {
							const groupId = deleting;
							props.onChange((draft) => ({
								...draft,
								supersets: draft.supersets.filter(({ clientId }) => clientId !== groupId),
							}));
							if (editing === groupId) {
								setEditing(undefined);
								setSelected([]);
							}
							setDeleting(undefined);
						}}
					/>
				)}
			</MotionPresence>
		</Dialog>
	);
}
