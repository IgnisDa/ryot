import type { RatingScale } from "@ryot-app/plugin-client-sdk";
import {
	createRyotBackgroundSubmission,
	useBackgroundSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	DestructiveConfirmation,
	RatingInput,
	RatingValue,
	StatusMessage,
	TextArea,
	useRatingDraft,
} from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { type RefObject, useEffect, useId, useRef, useState } from "react";

import type { ExerciseDetails } from "../../shared/exercise-details-recipes";
import {
	ExerciseNoteCreateInput,
	ExerciseNoteDeleteInput,
	exerciseNoteOperationSlugs,
	ExerciseNoteUpdateInput,
} from "../../shared/exercise-note-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { formatShortDate } from "../workout/format";
import type { WorkoutNote } from "./details-model";
import { cardHeadingClass, sectionHeadingClass } from "./styles";

type Note = ExerciseDetails["notes"][number];

const maxNoteLength = 2000;

const createNote = createRyotBackgroundSubmission({
	label: () => "Saved note",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: ExerciseNoteCreateInput,
	slug: exerciseNoteOperationSlugs.create,
	input: ({ input }: { readonly input: ExerciseNoteCreateInput }) => input,
});

const updateNote = createRyotBackgroundSubmission({
	label: () => "Updated note",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: ExerciseNoteUpdateInput,
	slug: exerciseNoteOperationSlugs.update,
	input: ({ input }: { readonly input: ExerciseNoteUpdateInput }) => input,
});

const deleteNote = createRyotBackgroundSubmission({
	label: () => "Deleted note",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: ExerciseNoteDeleteInput,
	slug: exerciseNoteOperationSlugs.delete,
	input: ({ input }: { readonly input: ExerciseNoteDeleteInput }) => input,
});

const failureMessage = (error: null | Error) =>
	error === null ? undefined : "This change couldn't be started. Try again.";

export function WorkoutNotes(props: { readonly notes: readonly WorkoutNote[] }) {
	if (props.notes.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-3 border-t border-border pt-4">
			<div className="flex items-baseline justify-between">
				<h3 className={cardHeadingClass}>From your workouts</h3>
				<span className="text-[13px] text-text-muted">Read-only</span>
			</div>
			<ul className="flex flex-col gap-3">
				{props.notes.map((note) => (
					<li key={note.text} className="flex flex-col gap-0.5">
						<span className="whitespace-pre-wrap break-words text-[15px] text-text">
							“{note.text}”
						</span>
						<span className="text-[13px] text-text-muted">
							{[
								note.source,
								note.latestAt === null ? null : formatShortDate(note.latestAt, null),
								note.count > 1 ? `${note.count} times` : null,
							]
								.filter((part) => part !== null)
								.join(" · ")}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export function NotesSection(props: {
	readonly exerciseId: string;
	readonly focusRequest: number;
	readonly ratingScale: RatingScale;
	readonly notes: ExerciseDetails["notes"];
	readonly workoutNotes: readonly WorkoutNote[];
}) {
	const [composerKey, setComposerKey] = useState(0);
	return (
		<section
			aria-label="Your notes"
			className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-5 font-ui"
		>
			<div className="flex items-baseline justify-between">
				<h2 className={sectionHeadingClass}>Your notes</h2>
				<span className="text-[13px] text-text-muted">Private to you</span>
			</div>
			<NoteComposer
				key={composerKey}
				exerciseId={props.exerciseId}
				ratingScale={props.ratingScale}
				focusRequest={props.focusRequest}
				onSaved={() => setComposerKey((key) => key + 1)}
			/>
			{props.notes.length === 0 ? null : (
				<ul className="flex flex-col gap-3">
					{props.notes.map((note) => (
						<NoteRow note={note} key={note.id} ratingScale={props.ratingScale} />
					))}
				</ul>
			)}
			<WorkoutNotes notes={props.workoutNotes} />
		</section>
	);
}

function DeleteNoteConfirmation(props: {
	readonly noteId: string;
	readonly onClose: () => void;
	readonly onDeleted: () => void;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const { onDeleted } = props;
	const remove = useBackgroundSubmission(deleteNote);
	return (
		<DestructiveConfirmation
			title="Delete note?"
			onClose={props.onClose}
			pendingLabel="Deleting…"
			actionLabel="Delete note"
			pending={remove.isSending}
			triggerRef={props.triggerRef}
			errorMessage={failureMessage(remove.error)}
			detail="This private note will be removed permanently."
			onConfirm={() => remove.submit({ noteId: props.noteId }, { onAccepted: onDeleted })}
		/>
	);
}

function NoteEditor(props: {
	readonly note: Note;
	readonly onCancel: () => void;
	readonly onChanged: () => void;
	readonly ratingScale: RatingScale;
}) {
	const inputId = useId();
	const [text, setText] = useState(props.note.text ?? "");
	const rating = useRatingDraft(props.note.rating, props.ratingScale);
	const update = useBackgroundSubmission(updateNote);
	const { onChanged } = props;
	const trimmed = text.trim();
	const save = () => {
		if (rating.result.valid) {
			update.submit(
				{ text: trimmed, noteId: props.note.id, rating: rating.result.rating },
				{ onAccepted: onChanged },
			);
		}
	};
	const message = failureMessage(update.error);
	return (
		<div className="flex flex-col gap-3">
			<label htmlFor={inputId} className="sr-only">
				Edit note
			</label>
			<TextArea
				rows={3}
				id={inputId}
				value={text}
				maxLength={maxNoteLength}
				onChange={(event) => setText(event.currentTarget.value)}
			/>
			<RatingInput
				value={rating.draft}
				scale={props.ratingScale}
				onChange={rating.setDraft}
				disabled={update.isSending}
			/>
			<div className="flex gap-2">
				<Button
					onClick={save}
					disabled={trimmed === "" || !rating.result.valid || update.isSending}
				>
					{update.isSending ? "Saving…" : "Save"}
				</Button>
				<Button variant="secondary" onClick={props.onCancel} disabled={update.isSending}>
					Cancel
				</Button>
			</div>
			{message === undefined ? null : <StatusMessage tone="error">{message}</StatusMessage>}
		</div>
	);
}

function NoteRow(props: { readonly note: Note; readonly ratingScale: RatingScale }) {
	const { note } = props;
	const deleteTrigger = useRef<HTMLButtonElement>(null);
	const [editing, setEditing] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const hasText = note.text !== null && note.text.trim() !== "";
	if (editing) {
		return (
			<li className="rounded-lg border border-border bg-surface-2 p-3">
				<NoteEditor
					note={note}
					ratingScale={props.ratingScale}
					onCancel={() => setEditing(false)}
					onChanged={() => setEditing(false)}
				/>
			</li>
		);
	}
	return (
		<li className="flex flex-col gap-2 rounded-lg border border-border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-text-muted">
				<span>{formatShortDate(note.occurredAt, null)}</span>
				{note.rating === null ? null : (
					<RatingValue
						rating={note.rating}
						scale={props.ratingScale}
						className="text-accent-text"
					/>
				)}
			</div>
			<p
				className={clsx(
					"whitespace-pre-wrap break-words text-[15px]",
					hasText ? "text-text" : "text-text-muted italic",
				)}
			>
				{hasText ? note.text : "Empty note"}
			</p>
			<div className="flex gap-2">
				<Button variant="ghost" aria-label="Edit note" onClick={() => setEditing(true)}>
					Edit
				</Button>
				<Button
					variant="ghost"
					ref={deleteTrigger}
					aria-label="Delete note"
					onClick={() => setConfirming(true)}
				>
					Delete
				</Button>
			</div>
			{confirming ? (
				<DeleteNoteConfirmation
					noteId={note.id}
					triggerRef={deleteTrigger}
					onClose={() => setConfirming(false)}
					onDeleted={() => setConfirming(false)}
				/>
			) : null}
		</li>
	);
}

function NoteComposer(props: {
	readonly exerciseId: string;
	readonly onSaved: () => void;
	readonly focusRequest: number;
	readonly ratingScale: RatingScale;
}) {
	const { onSaved } = props;
	const inputId = useId();
	const textArea = useRef<HTMLTextAreaElement>(null);
	const handledFocusRequest = useRef(props.focusRequest);
	const [text, setText] = useState("");
	const rating = useRatingDraft(null, props.ratingScale);
	const create = useBackgroundSubmission(createNote);
	const { focusRequest } = props;
	useEffect(() => {
		if (focusRequest !== handledFocusRequest.current) {
			handledFocusRequest.current = focusRequest;
			textArea.current?.focus();
		}
	}, [focusRequest]);
	const trimmed = text.trim();
	const save = () => {
		if (rating.result.valid) {
			create.submit(
				{
					text: trimmed,
					exerciseId: props.exerciseId,
					...(rating.result.rating === null ? {} : { rating: rating.result.rating }),
				},
				{ onAccepted: onSaved },
			);
		}
	};
	const message = failureMessage(create.error);
	return (
		<div className="flex flex-col gap-3">
			<label htmlFor={inputId} className="text-[14px] font-semibold text-text-muted">
				New note
			</label>
			<TextArea
				rows={3}
				id={inputId}
				value={text}
				ref={textArea}
				maxLength={maxNoteLength}
				placeholder="Cues, setup, how it felt…"
				onChange={(event) => setText(event.currentTarget.value)}
			/>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<RatingInput
					value={rating.draft}
					scale={props.ratingScale}
					onChange={rating.setDraft}
					disabled={create.isSending}
				/>
				<Button
					onClick={save}
					disabled={trimmed === "" || !rating.result.valid || create.isSending}
				>
					{create.isSending ? "Saving…" : "Save note"}
				</Button>
			</div>
			{message === undefined ? null : <StatusMessage tone="error">{message}</StatusMessage>}
		</div>
	);
}
