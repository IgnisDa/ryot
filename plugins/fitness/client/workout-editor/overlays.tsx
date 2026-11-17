import {
	createRyotQuery,
	type Formatters,
	nextPageCursor,
	PaginationError,
	paginationItems,
	useFormatters,
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
import { type RefObject, useLayoutEffect, useRef, useState } from "react";

import { type SupersetColor, supersetColor, supersetColors } from "../../shared/superset-colors";
import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type {
	WorkoutHistoryResult,
	WorkoutHistorySetResult,
} from "../../shared/workout-history-recipes";
import { supersetColorVariable } from "../group-colors";
import { type FitnessText, useFitnessMessages } from "../messages";
import { formatMeasure } from "../workout/format";
import { removeWorkoutItems } from "./actions";
import { type DraftChange, pruneSupersets, supersetOf } from "./draft-ops";
import { EditorSheet } from "./editor-sheet";
import { editorHistoryQuery, readHistorySets } from "./queries";
import { supersetNames } from "./superset-group";
import { ConfirmDialog } from "./workout-sheets";

const historySetsQuery = createRyotQuery<
	{ readonly workoutId: string; readonly exerciseId: string },
	WorkoutHistorySetResult["items"]
>(({ input, client }) => readHistorySets(client, input.workoutId, input.exerciseId));

const historySetText = (
	formatters: Formatters,
	text: FitnessText,
	set: WorkoutHistorySetResult["items"][number],
	imperial: boolean,
) =>
	[
		set.weight === null ? null : formatMeasure(formatters, text, set.weight, "weight", imperial),
		set.reps === null ? null : formatMeasure(formatters, text, set.reps, "reps"),
		set.duration === null ? null : formatMeasure(formatters, text, set.duration, "duration"),
		set.distance === null
			? null
			: formatMeasure(formatters, text, set.distance, "distance", imperial),
		set.rpe === null ? null : text("client.template.rpe", { rpe: set.rpe }),
		set.note ? text("client.exercise.notes.quote", { note: set.note }) : null,
	]
		.filter(Boolean)
		.join(" · ");

const useRevealInitial = (
	ref: RefObject<null | HTMLElement>,
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

type DraftOverlayProps = {
	readonly onClose: () => void;
	readonly onChange: DraftChange;
	readonly draft: WorkoutEditorDraft;
	readonly names: ReadonlyMap<string, string>;
	readonly initialOccurrenceId?: string | undefined;
	readonly onMoved?: (occurrenceId: string) => void;
};

export function HistoryRequiresPro(props: {
	readonly onClose: () => void;
	readonly exerciseName: string;
}) {
	const text = useFitnessMessages();
	return (
		<EditorSheet
			onClose={props.onClose}
			description={props.exerciseName}
			closeLabel={text("client.history.close")}
			title={text("client.history.exercise-title")}
			footer={<Button onClick={props.onClose}>{text("client.history.got-it")}</Button>}
		>
			<Notice
				tone="info"
				icon={<AppIcon size={16} name="info" />}
				title={text("client.history.pro-title")}
			>
				{text("client.history.pro-body")}
			</Notice>
		</EditorSheet>
	);
}

export function HistoryOverlay(props: {
	readonly imperial: boolean;
	readonly exerciseId: string;
	readonly onClose: () => void;
	readonly exerciseName: string;
	readonly beforeStartedAt: string | undefined;
	readonly excludeWorkoutId: string | undefined;
	readonly onAppend: (sets: WorkoutHistorySetResult["items"]) => void;
}) {
	const text = useFitnessMessages();
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
			onClose={props.onClose}
			description={props.exerciseName}
			title={text("client.history.title")}
			closeLabel={text("client.history.close")}
			footer={
				hasMore ? (
					<LoadMoreButton
						className="w-full"
						variant="secondary"
						onClick={history.fetchNextPage}
						label={text("client.history.more-sessions")}
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
						title={text("client.history.empty-title")}
						icon={<AppIcon size={20} name="history" />}
						description={text("client.history.empty-description")}
					/>
				) : null}
				{history.isPending ? (
					<div role="status" className="grid gap-3" aria-label={text("client.history.loading")}>
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
								{text("client.history.retry")}
							</Button>
						}
					>
						{text("client.history.load-failed")}
					</Notice>
				) : null}
				{invalidCursor ? (
					<Notice tone="danger" icon={<AppIcon size={16} name="circle-alert" />}>
						{text("client.history.pagination-failed")}
					</Notice>
				) : null}
			</div>
		</EditorSheet>
	);
}

function HistorySession(props: {
	readonly imperial: boolean;
	readonly exerciseId: string;
	readonly session: WorkoutHistoryResult["items"][number];
	readonly onAppend: (sets: WorkoutHistorySetResult["items"]) => void;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
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
						{formatters
							.dateTime({ timeStyle: "short", dateStyle: "medium" })
							.format(new Date(props.session.startedAt))}
					</p>
				</div>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => setConfirming(true)}
					disabled={result.data === undefined}
				>
					<AppIcon size={14} name="plus" />
					{text("client.history.add-sets")}
				</Button>
			</div>
			{props.session.comment ? (
				<p className="text-sm text-text-muted">{props.session.comment}</p>
			) : null}
			{result.data === undefined && !result.isError ? (
				<div
					role="status"
					className="grid gap-1.5"
					aria-label={text("client.history.loading-sets")}
				>
					<Skeleton className="h-4 w-2/3" />
					<Skeleton className="h-4 w-1/2" />
				</div>
			) : null}
			{result.data === undefined ? null : (
				<ol className="grid list-decimal gap-0.5 pl-5 text-sm tabular-nums">
					{result.data.map((set) => (
						<li key={set.id}>{historySetText(formatters, text, set, props.imperial)}</li>
					))}
				</ol>
			)}
			{result.isError ? (
				<Notice
					tone="danger"
					icon={<AppIcon size={16} name="circle-alert" />}
					action={
						<Button size="sm" variant="secondary" onClick={result.refetch}>
							{text("client.history.retry-sets")}
						</Button>
					}
				>
					{text("client.history.sets-failed")}
				</Notice>
			) : null}
			<MotionPresence>
				{confirming ? (
					<ConfirmDialog
						key="append-history"
						disabled={result.data === undefined}
						onClose={() => setConfirming(false)}
						cancelLabel={text("common.action.cancel")}
						confirmLabel={text("client.history.add-sets")}
						title={text("client.history.add-title", { name: props.session.name })}
						description={text("client.history.add-description", {
							count: result.data?.length ?? 0,
						})}
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

const sectionHeading = "text-[11px] font-semibold tracking-wider text-text-subtle uppercase";

export function ReorderOverlay(
	props: DraftOverlayProps & { readonly onDrop: () => void; readonly onPickUp: () => void },
) {
	const text = useFitnessMessages();
	const scrollRef = useRef<HTMLDivElement>(null);
	const initialOccurrenceRef = useRef<HTMLDivElement>(null);
	useRevealInitial(initialOccurrenceRef, props.initialOccurrenceId);
	const groups = supersetNames(text, props.draft);
	return (
		<EditorSheet
			onClose={props.onClose}
			title={text("client.reorder.title")}
			closeLabel={text("client.reorder.close")}
			footer={<Button onClick={props.onClose}>{text("common.action.done")}</Button>}
		>
			<div ref={scrollRef} className="max-h-[60vh] overflow-y-auto">
				<ReorderableList
					itemHeight={56}
					onDrop={props.onDrop}
					scrollRef={scrollRef}
					onPickUp={props.onPickUp}
					items={props.draft.occurrences}
					itemKey={(item) => item.clientId}
					label={text("property.exercise-order-2")}
					handleIcon={<AppIcon size={18} name="grip-vertical" />}
					itemLabel={(item) =>
						props.names.get(item.exerciseId) ?? text("client.overlays.exercise-unavailable")
					}
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
						let progress = text("client.reorder.not-started");
						if (completedSets > 0) {
							progress =
								completedSets === item.sets.length
									? text("client.reorder.complete")
									: text("client.reorder.in-progress");
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
										{props.names.get(item.exerciseId) ??
											text("client.overlays.exercise-unavailable")}
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
	const text = useFitnessMessages();
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
			closeLabel={text("client.bulk.close")}
			title={text("client.editor.delete-sets")}
			footer={
				<>
					<Button variant="secondary" onClick={props.onClose}>
						{text("common.action.cancel")}
					</Button>
					<Button variant="danger" disabled={count === 0} onClick={() => setConfirming(true)}>
						{count === 0
							? text("client.bulk.delete-selected")
							: text("client.bulk.delete-count", { count })}
					</Button>
				</>
			}
		>
			<div className="grid gap-3">
				{props.draft.occurrences.map((occurrence) => {
					const name =
						props.names.get(occurrence.exerciseId) ?? text("client.overlays.exercise-unavailable");
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
										<span className="text-text-muted"> · {text("client.bulk.whole-exercise")}</span>
									</span>
								}
							/>
							{occurrence.sets.length === 0 ? null : (
								<div className="flex flex-wrap gap-x-4 pl-7">
									{occurrence.sets.map((set, setIndex) => (
										<Checkbox
											disabled={whole}
											key={set.clientId}
											checked={whole || sets.includes(set.clientId)}
											label={text("client.bulk.set", { index: setIndex + 1 })}
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
						disabled={count === 0}
						key="bulk-delete-confirm"
						onClose={() => setConfirming(false)}
						title={text("client.bulk.confirm-title")}
						cancelLabel={text("common.action.cancel")}
						confirmLabel={text("client.bulk.delete-selected")}
						description={text("client.bulk.confirm-description", {
							sets: selectedSetCount,
							exercises: selectedExercises.length,
						})}
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
	const text = useFitnessMessages();
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
	const groups = supersetNames(text, props.draft);
	const memberNames = (occurrenceIds: readonly string[]) =>
		occurrenceIds
			.map((id) => {
				const occurrence = props.draft.occurrences.find(({ clientId }) => clientId === id);
				return occurrence === undefined ? "" : props.names.get(occurrence.exerciseId);
			})
			.join(" + ");
	return (
		<EditorSheet
			onClose={props.onClose}
			title={text("property.supersets")}
			closeLabel={text("client.supersets.close")}
			description={text("client.supersets.description")}
			footer={
				<>
					<Button variant="secondary" onClick={props.onClose}>
						{text("common.action.done")}
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
						{editing === undefined
							? text("client.supersets.create")
							: text("client.supersets.save")}
					</Button>
				</>
			}
		>
			<div className="grid gap-5">
				<Collapse open={props.draft.supersets.length > 0}>
					<section className="grid gap-2">
						<h3 className={sectionHeading}>{text("client.supersets.current")}</h3>
						<MotionList className="grid gap-2">
							{props.draft.supersets.map((group) => {
								const name = groups.get(group.clientId) ?? text("client.superset.fallback");
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
											aria-label={text("client.supersets.edit-label", { name })}
											onClick={() => {
												setEditing(group.clientId);
												setSelected(group.occurrenceIds);
												setColor(supersetColor(group.color));
											}}
										>
											{text("common.action.edit")}
										</Button>
										<IconButton
											size="sm"
											tone="danger"
											onClick={() => setDeleting(group.clientId)}
											label={text("client.supersets.delete-label", { name })}
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
							? text("client.supersets.new")
							: text("client.supersets.editing", {
									name: groups.get(editing) ?? text("client.superset.fallback"),
								})}
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
											{props.names.get(occurrence.exerciseId) ??
												text("client.overlays.exercise-unavailable")}
											{other === undefined ? null : (
												<span className="text-text-subtle">
													{" "}
													·{" "}
													{text("client.supersets.in", { name: groups.get(other.clientId) ?? "" })}
												</span>
											)}
										</span>
									}
								/>
							);
						})}
					</div>
					<div className="grid gap-1.5">
						<span className="text-[13px] font-medium">{text("property.color")}</span>
						<RadioGroup
							value={color}
							onChange={setColor}
							className="flex flex-wrap gap-2"
							label={text("client.supersets.color-label")}
							options={supersetColors.map((value) => ({
								value,
								label: text("client.supersets.color-name", { color: value }),
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
					<p className="text-xs text-text-muted">{text("client.supersets.note")}</p>
				</section>
			</div>
			<MotionPresence>
				{deleting === undefined ? null : (
					<ConfirmDialog
						key="superset-delete-confirm"
						onClose={() => setDeleting(undefined)}
						cancelLabel={text("common.action.cancel")}
						confirmLabel={text("client.supersets.delete")}
						description={text("client.supersets.delete-description")}
						title={text("client.supersets.delete-title", {
							name: groups.get(deleting) ?? text("client.superset.fallback"),
						})}
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
