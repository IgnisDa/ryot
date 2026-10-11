import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Modal, ReorderableList, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useRef, useState } from "react";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type {
	WorkoutHistoryResult,
	WorkoutHistorySetResult,
} from "../../shared/workout-history-recipes";
import { removeWorkoutItems } from "./actions";
import { EditorSelect, editorModalClass } from "./controls";
import { editorHistoryQuery, readHistorySets } from "./queries";

const historySetsQuery = createRyotQuery<
	{ readonly workoutId: string; readonly exerciseId: string },
	WorkoutHistorySetResult["items"]
>(({ input, client }) => readHistorySets(client, input.workoutId, input.exerciseId));

function HistorySession(props: {
	readonly session: WorkoutHistoryResult["items"][number];
	readonly exerciseId: string;
	readonly onAppend: (sets: WorkoutHistorySetResult["items"]) => void;
}) {
	const result = useRyotQuery(historySetsQuery, {
		workoutId: props.session.id,
		exerciseId: props.exerciseId,
	});
	return (
		<section className="rounded-lg border border-border p-3">
			<h3 className="font-semibold">{props.session.name}</h3>
			<p className="text-sm">{new Date(props.session.startedAt).toLocaleString()}</p>
			{props.session.comment ? <p>{props.session.comment}</p> : null}
			{result.data === undefined ? (
				<StatusMessage tone={result.isError ? "error" : "pending"}>
					{result.isError ? "History sets could not be loaded." : "Loading sets…"}
				</StatusMessage>
			) : (
				<ol className="text-sm">
					{result.data.map((set) => (
						<li key={set.id}>
							{[
								set.reps === null ? null : `${set.reps} reps`,
								set.weight === null ? null : `${set.weight} kg`,
								set.duration === null ? null : `${set.duration} seconds`,
								set.distance === null ? null : `${set.distance} km`,
							]
								.filter(Boolean)
								.join(" · ")}
							{set.note ? ` · ${set.note}` : ""}
						</li>
					))}
				</ol>
			)}
			{result.isError ? (
				<Button variant="secondary" onClick={result.refetch}>
					Retry history sets
				</Button>
			) : null}
			<Button
				variant="secondary"
				disabled={result.data === undefined}
				onClick={() => {
					if (result.data !== undefined) {
						props.onAppend(result.data);
					}
				}}
			>
				Append all sets
			</Button>
		</section>
	);
}

export function HistoryOverlay(props: {
	readonly exerciseId: string;
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
		<Modal
			onClose={props.onClose}
			label="Exercise history"
			closeLabel="Close history"
			className={editorModalClass}
		>
			<h2 className="text-xl font-semibold">Exercise history</h2>
			{sessions.map((session) => (
				<HistorySession
					key={session.id}
					session={session}
					onAppend={props.onAppend}
					exerciseId={props.exerciseId}
				/>
			))}
			{sessions.length === 0 && result.isSuccess ? <p>No earlier sessions.</p> : null}
			{result.isPending ? <StatusMessage tone="pending">Loading history…</StatusMessage> : null}
			{result.isError ? (
				<>
					<StatusMessage tone="error">History could not be loaded.</StatusMessage>
					<Button onClick={result.refetch}>Retry history</Button>
				</>
			) : null}
			{invalidCursor ? (
				<StatusMessage tone="error">
					History pagination could not continue. Retry loading this page.
				</StatusMessage>
			) : null}
			{result.data?.pageInfo.hasMore ? (
				<Button
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
			) : null}
			<Button variant="secondary" onClick={props.onClose}>
				Close
			</Button>
		</Modal>
	);
}

export function ReorderOverlay(props: {
	readonly draft: WorkoutEditorDraft;
	readonly names: ReadonlyMap<string, string>;
	readonly onChange: (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => void;
	readonly onClose: () => void;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	return (
		<Modal
			onClose={props.onClose}
			label="Reorder exercises"
			closeLabel="Close reorder"
			className={editorModalClass}
		>
			<h2 className="text-xl font-semibold">Reorder exercises</h2>
			<div ref={scrollRef} className="max-h-96 overflow-y-auto">
				<ReorderableList
					itemHeight={56}
					scrollRef={scrollRef}
					label="Exercise order"
					items={props.draft.occurrences}
					itemKey={(item) => item.clientId}
					handleIcon={<AppIcon size={18} name="grip-vertical" />}
					itemLabel={(item) => props.names.get(item.exerciseId) ?? "Unavailable exercise"}
					renderItem={({ item, handle }) => (
						<div className="flex h-14 items-center gap-3">
							{handle}
							<span className="min-w-0 flex-1 truncate">
								{props.names.get(item.exerciseId) ?? "Unavailable exercise"}
							</span>
						</div>
					)}
					onReorder={(from, to) =>
						props.onChange((draft) => {
							const occurrences = [...draft.occurrences];
							const item = occurrences.splice(from, 1)[0];
							if (item === undefined) {
								return draft;
							}
							occurrences.splice(to, 0, item);
							return { ...draft, occurrences };
						})
					}
				/>
			</div>
			<Button onClick={props.onClose}>Done</Button>
		</Modal>
	);
}

const toggleSelection = (values: readonly string[], id: string) =>
	values.includes(id) ? values.filter((value) => value !== id) : [...values, id];

export function BulkDeleteOverlay(props: {
	readonly draft: WorkoutEditorDraft;
	readonly names: ReadonlyMap<string, string>;
	readonly onChange: (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => void;
	readonly onClose: () => void;
}) {
	const [occurrences, setOccurrences] = useState<readonly string[]>([]);
	const [sets, setSets] = useState<readonly string[]>([]);
	return (
		<Modal
			label="Bulk delete"
			onClose={props.onClose}
			className={editorModalClass}
			closeLabel="Cancel bulk delete"
		>
			<h2 className="text-xl font-semibold">Delete exercises or sets</h2>
			{props.draft.occurrences.map((occurrence, index) => (
				<fieldset
					key={occurrence.clientId}
					className="flex flex-col gap-2 rounded-lg border border-border p-3"
				>
					<legend>
						Exercise {index + 1}: {props.names.get(occurrence.exerciseId) ?? "Unavailable exercise"}
					</legend>
					<label>
						<input
							type="checkbox"
							checked={occurrences.includes(occurrence.clientId)}
							onChange={() => setOccurrences(toggleSelection(occurrences, occurrence.clientId))}
						/>{" "}
						Delete whole exercise
					</label>
					{occurrence.sets.map((set, setIndex) => (
						<label key={set.clientId}>
							<input
								type="checkbox"
								disabled={occurrences.includes(occurrence.clientId)}
								onChange={() => setSets(toggleSelection(sets, set.clientId))}
								checked={occurrences.includes(occurrence.clientId) || sets.includes(set.clientId)}
							/>{" "}
							Set {setIndex + 1}
						</label>
					))}
				</fieldset>
			))}
			<Button
				disabled={occurrences.length + sets.length === 0}
				onClick={() => {
					props.onChange((draft) => removeWorkoutItems(draft, occurrences, sets));
					props.onClose();
				}}
			>
				Delete selected
			</Button>
			<Button variant="secondary" onClick={props.onClose}>
				Cancel
			</Button>
		</Modal>
	);
}

export function SupersetOverlay(props: {
	readonly draft: WorkoutEditorDraft;
	readonly names: ReadonlyMap<string, string>;
	readonly onChange: (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => void;
	readonly onClose: () => void;
}) {
	const [editing, setEditing] = useState<string>();
	const [selected, setSelected] = useState<readonly string[]>([]);
	const [color, setColor] = useState("blue");
	return (
		<Modal
			label="Supersets"
			onClose={props.onClose}
			closeLabel="Close supersets"
			className={editorModalClass}
		>
			<h2 className="text-xl font-semibold">Supersets</h2>
			{props.draft.supersets.map((group) => (
				<div key={group.clientId} className="flex flex-wrap items-center gap-2">
					<span>
						{group.color}:{" "}
						{group.occurrenceIds
							.map((id) => {
								const occurrence = props.draft.occurrences.find(({ clientId }) => clientId === id);
								return occurrence === undefined ? "" : props.names.get(occurrence.exerciseId);
							})
							.join(" + ")}
					</span>
					<Button
						variant="secondary"
						onClick={() => {
							setEditing(group.clientId);
							setSelected(group.occurrenceIds);
							setColor(group.color);
						}}
					>
						Edit superset
					</Button>
					<Button
						variant="text"
						onClick={() =>
							props.onChange((draft) => ({
								...draft,
								supersets: draft.supersets.filter(({ clientId }) => clientId !== group.clientId),
							}))
						}
					>
						Delete superset
					</Button>
				</div>
			))}
			{props.draft.occurrences.map((occurrence, index) => (
				<label key={occurrence.clientId} className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={selected.includes(occurrence.clientId)}
						onChange={() =>
							setSelected(
								selected.includes(occurrence.clientId)
									? selected.filter((id) => id !== occurrence.clientId)
									: [...selected, occurrence.clientId],
							)
						}
					/>
					{index + 1}. {props.names.get(occurrence.exerciseId) ?? "Unavailable exercise"}
				</label>
			))}
			<EditorSelect
				value={color}
				onChange={setColor}
				label="Superset color"
				choices={["blue", "purple", "teal", "orange", "crimson"].map((value) => ({
					value,
					label: value[0]?.toUpperCase() + value.slice(1),
				}))}
			/>
			<Button
				disabled={selected.length < 2 || color.trim() === ""}
				onClick={() => {
					props.onChange((draft) => ({
						...draft,
						supersets: [
							...draft.supersets
								.filter(({ clientId }) => clientId !== editing)
								.flatMap((group) => {
									const occurrenceIds = group.occurrenceIds.filter((id) => !selected.includes(id));
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
			<Button variant="secondary" onClick={props.onClose}>
				Done
			</Button>
		</Modal>
	);
}
