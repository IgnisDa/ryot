import {
	createRyotQuery,
	nextPageCursor,
	paginationItems,
	PaginationError,
	useRyotInfiniteQuery,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	Checkbox,
	Collapse,
	EmptyState,
	IconButton,
	LoadMoreButton,
	MotionList,
	MotionPresence,
	Notice,
	RadioGroup,
	ReorderableList,
	Skeleton,
	usePrefersReducedMotion,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import { supersetColor, supersetColors, type SupersetColor } from "../../shared/superset-colors";
import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type {
	WorkoutHistoryResult,
	WorkoutHistorySetResult,
} from "../../shared/workout-history-recipes";
import { supersetColorVariable } from "../group-colors";
import { formatMeasure } from "../workout/format";
import { removeWorkoutItems } from "./actions";
import { pruneSupersets, supersetOf, type DraftChange } from "./draft-ops";
import { EditorSheet } from "./editor-sheet";
import { editorHistoryQuery, readHistorySets } from "./queries";
import { supersetNames } from "./superset-group";
import { ConfirmDialog } from "./workout-sheets";

const historySetsQuery = createRyotQuery<
	{ readonly workoutId: string; readonly exerciseId: string },
	WorkoutHistorySetResult["items"]
>(({ input, client }) => readHistorySets(client, input.workoutId, input.exerciseId));

const historySetText = (set: WorkoutHistorySetResult["items"][number], imperial: boolean) =>
	[
		set.weight === null ? null : formatMeasure(set.weight, "kg", imperial),
		set.reps === null ? null : formatMeasure(set.reps, "reps"),
		set.duration === null ? null : formatMeasure(set.duration, "seconds"),
		set.distance === null ? null : formatMeasure(set.distance, "km", imperial),
		set.rpe === null ? null : `RPE ${set.rpe}`,
		set.note ? `“${set.note}”` : null,
	]
		.filter(Boolean)
		.join(" · ");

const useRevealInitial = (
	ref: RefObject<HTMLElement | null>,
	initialOccurrenceId: string | undefined,
) => {
	const reduced = usePrefersReducedMotion();
	useLayoutEffect(() => {
		const element = ref.current;
		if (
			initialOccurrenceId !== undefined &&
			element !== null &&
			element.getBoundingClientRect().height > 0
		) {
			element.scrollIntoView({ block: "nearest", behavior: reduced ? "instant" : "smooth" });
		}
	}, [initialOccurrenceId, reduced, ref]);
};

function HistorySession(props: {
	readonly session: WorkoutHistoryResult["items"][number];
	readonly exerciseId: string;
	readonly imperial: boolean;
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
						<li key={set.id}>{historySetText(set, props.imperial)}</li>
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
	readonly exerciseName: string;
	readonly onClose: () => void;
}) {
	return (
		<EditorSheet
			onClose={props.onClose}
			title="Exercise history"
			closeLabel="Close history"
			description={props.exerciseName}
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
		</EditorSheet>
	);
}

export function HistoryOverlay(props: {
	readonly imperial: boolean;
	readonly exerciseId: string;
	readonly exerciseName: string;
	readonly beforeStartedAt: string | undefined;
	readonly excludeWorkoutId: string | undefined;
	readonly onClose: () => void;
	readonly onAppend: (sets: WorkoutHistorySetResult["items"]) => void;
}) {
	const history = useRyotInfiniteQuery(
		editorHistoryQuery,
		{
			exerciseId: props.exerciseId,
			beforeStartedAt: props.beforeStartedAt,
			excludeWorkoutId: props.excludeWorkoutId,
		},
		{
			initialPageParam: undefined,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after }),
		},
	);
	const items = paginationItems(
		history.pages,
		(page) => page.items,
		({ id }) => id,
	);
	const invalidCursor = history.error instanceof PaginationError;
	const hasMore = history.hasNextPage || invalidCursor;
	return (
		<EditorSheet
			wide="side"
			title="History"
			onClose={props.onClose}
			closeLabel="Close history"
			description={props.exerciseName}
			footer={
				hasMore ? (
					<LoadMoreButton
						className="w-full"
						variant="secondary"
						label="More sessions"
						onClick={history.fetchNextPage}
						isFetchingNextPage={history.isFetchingNextPage}
						disabled={history.isFetching || history.isError || invalidCursor}
					/>
				) : undefined
			}
		>
			<div className="grid gap-3">
				<MotionList className="grid gap-3 empty:hidden">
					{items.map((session) => (
						<HistorySession
							key={session.id}
							session={session}
							imperial={props.imperial}
							onAppend={props.onAppend}
							exerciseId={props.exerciseId}
						/>
					))}
				</MotionList>
				{items.length === 0 && history.isSuccess ? (
					<EmptyState
						title="No earlier sessions"
						icon={<AppIcon size={20} name="history" />}
						description="Sets you log for this exercise show up here next time."
					/>
				) : null}
				{history.isPending ? (
					<div role="status" className="grid gap-3" aria-label="Loading history">
						<Skeleton className="h-24" />
						<Skeleton className="h-24" />
					</div>
				) : null}
				{history.isError && !invalidCursor ? (
					<Notice
						tone="danger"
						icon={<AppIcon size={16} name="circle-alert" />}
						action={
							<Button size="sm" variant="secondary" onClick={history.retry}>
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
		</EditorSheet>
	);
}

type DraftOverlayProps = {
	readonly draft: WorkoutEditorDraft;
	readonly names: ReadonlyMap<string, string>;
	readonly initialOccurrenceId?: string | undefined;
	readonly onChange: DraftChange;
	readonly onClose: () => void;
	readonly onMoved?: (occurrenceId: string) => void;
};

const sectionHeading = "text-[11px] font-semibold tracking-wider text-text-subtle uppercase";

export function ReorderOverlay(
	props: DraftOverlayProps & { readonly onPickUp: () => void; readonly onDrop: () => void },
) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const initialOccurrenceRef = useRef<HTMLDivElement>(null);
	useRevealInitial(initialOccurrenceRef, props.initialOccurrenceId);
	const groups = supersetNames(props.draft);
	return (
		<EditorSheet
			onClose={props.onClose}
			title="Reorder exercises"
			closeLabel="Close reorder"
			footer={<Button onClick={props.onClose}>Done</Button>}
		>
			<div ref={scrollRef} className="max-h-[60vh] overflow-y-auto">
				<ReorderableList
					itemHeight={56}
					onDrop={props.onDrop}
					scrollRef={scrollRef}
					label="Exercise order"
					onPickUp={props.onPickUp}
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
						const group = supersetOf(props.draft, item.clientId);
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
											backgroundColor: supersetColorVariable(group.color, { soft: true }),
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
		</EditorSheet>
	);
}

const toggleSelection = (values: readonly string[], id: string) =>
	values.includes(id) ? values.filter((value) => value !== id) : [...values, id];

export function BulkDeleteOverlay(
	props: DraftOverlayProps & { readonly onDeletedSets: () => void },
) {
	const [occurrences, setOccurrences] = useState<readonly string[]>(() =>
		props.initialOccurrenceId === undefined ? [] : [props.initialOccurrenceId],
	);
	const [sets, setSets] = useState<readonly string[]>([]);
	const initialOccurrenceRef = useRef<HTMLFieldSetElement>(null);
	const [confirming, setConfirming] = useState(false);
	useRevealInitial(initialOccurrenceRef, props.initialOccurrenceId);
	const selectedExercises = props.draft.occurrences.filter(({ clientId }) =>
		occurrences.includes(clientId),
	);
	const selectedSetCount = props.draft.occurrences
		.filter(({ clientId }) => !occurrences.includes(clientId))
		.flatMap(({ sets: occurrenceSets }) => occurrenceSets)
		.filter(({ clientId }) => sets.includes(clientId)).length;
	const count = selectedExercises.length + selectedSetCount;
	return (
		<EditorSheet
			onClose={props.onClose}
			closeLabel="Cancel bulk delete"
			title="Delete exercises or sets"
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
						description={`Delete ${selectedExercises.length} ${selectedExercises.length === 1 ? "exercise" : "exercises"} and ${selectedSetCount} individual ${selectedSetCount === 1 ? "set" : "sets"}?`}
						onConfirm={() => {
							props.onChange((draft) => removeWorkoutItems(draft, occurrences, sets));
							if (selectedSetCount > 0) {
								props.onDeletedSets();
							}
							setConfirming(false);
							props.onClose();
						}}
					/>
				) : null}
			</MotionPresence>
		</EditorSheet>
	);
}

export function SupersetOverlay(props: DraftOverlayProps) {
	const initialOccurrenceId = props.initialOccurrenceId;
	const initialGroup =
		initialOccurrenceId === undefined ? undefined : supersetOf(props.draft, initialOccurrenceId);
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
		<EditorSheet
			title="Supersets"
			onClose={props.onClose}
			closeLabel="Close supersets"
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
									...pruneSupersets(
										draft.supersets.filter(({ clientId }) => clientId !== editing),
										(id) => !selected.includes(id),
									),
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
				<Collapse open={props.draft.supersets.length > 0}>
					<section className="grid gap-2">
						<h3 className={sectionHeading}>Current</h3>
						<MotionList className="grid gap-2">
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
						</MotionList>
					</section>
				</Collapse>
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
										style={{ backgroundColor: supersetColorVariable(option.value, { soft: true }) }}
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
		</EditorSheet>
	);
}
