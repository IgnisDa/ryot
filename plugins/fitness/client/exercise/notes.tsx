import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import type { Schema } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	DestructiveConfirmation,
	RadioGroup,
	StatusMessage,
	TextArea,
} from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import type { ExerciseDetails } from "../../shared/exercise-details-recipes";
import {
	ExerciseNoteCreateInput,
	ExerciseNoteDeleteInput,
	ExerciseNoteOutput,
	ExerciseNoteUpdateInput,
	exerciseNoteOperationSlugs,
} from "../../shared/exercise-note-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { formatShortDate } from "../workout/format";
import { ratingSteps, ratingToStars, starsToRating, type WorkoutNote } from "./details-model";
import { cardHeadingClass, sectionHeadingClass } from "./styles";

type Note = ExerciseDetails["notes"][number];

const maxNoteLength = 2000;

const noteMutation = <Input extends Schema.Codec<unknown, unknown>>(
	slug: string,
	inputSchema: Input,
) =>
	createRyotMutation<Input["Type"], ExerciseNoteOutput>(({ input, client }) =>
		client.operations.invoke({
			slug,
			input,
			inputSchema,
			output: ExerciseNoteOutput,
			packageId: PLUGIN_PACKAGE_ID,
		}),
	);

const createNoteMutation = noteMutation(exerciseNoteOperationSlugs.create, ExerciseNoteCreateInput);

const updateNoteMutation = noteMutation(exerciseNoteOperationSlugs.update, ExerciseNoteUpdateInput);

const deleteNoteMutation = noteMutation(exerciseNoteOperationSlugs.delete, ExerciseNoteDeleteInput);

const failureMessage = (error: Error | null) => {
	if (error === null) {
		return undefined;
	}
	return error instanceof RyotClientError && error.reason === "operation-failed"
		? "The server declined this change. Demo accounts can't edit notes."
		: "This change couldn't be saved. Try again.";
};

function StarRating(props: {
	readonly label: string;
	readonly stars: number | undefined;
	readonly onChange: (stars: number | undefined) => void;
}) {
	return (
		<RadioGroup
			label={props.label}
			className="flex gap-1"
			value={props.stars === undefined ? undefined : String(props.stars)}
			onChange={(value) =>
				props.onChange(Number(value) === props.stars ? undefined : Number(value))
			}
			options={Array.from({ length: ratingSteps }, (_, index) => ({
				value: String(index + 1),
				label: `${index + 1} ${index === 0 ? "star" : "stars"}`,
			}))}
			renderOption={(option) => ({
				content: "★",
				className: clsx(
					"grid size-9 place-items-center text-2xl leading-none",
					props.stars !== undefined && Number(option.value) <= props.stars
						? "text-accent"
						: "text-text-subtle",
				),
			})}
		/>
	);
}

function Stars(props: { readonly rating: number }) {
	const stars = ratingToStars(props.rating);
	if (stars === null) {
		return null;
	}
	return (
		<span role="img" className="text-accent" aria-label={`Rated ${stars} of ${ratingSteps}`}>
			{"★".repeat(stars)}
			<span className="text-text-subtle">{"★".repeat(ratingSteps - stars)}</span>
		</span>
	);
}

function NoteComposer(props: {
	readonly exerciseId: string;
	readonly onSaved: () => void;
	readonly focusRequest: number;
}) {
	const { onSaved } = props;
	const inputId = useId();
	const textArea = useRef<HTMLTextAreaElement>(null);
	const handledFocusRequest = useRef(props.focusRequest);
	const [text, setText] = useState("");
	const [stars, setStars] = useState<number | undefined>();
	const create = useRyotMutation(createNoteMutation);
	const { focusRequest } = props;
	useEffect(() => {
		if (focusRequest !== handledFocusRequest.current) {
			handledFocusRequest.current = focusRequest;
			textArea.current?.focus();
		}
	}, [focusRequest]);
	useEffect(() => {
		if (create.data !== undefined) {
			onSaved();
		}
	}, [create.data, onSaved]);
	const trimmed = text.trim();
	const save = () =>
		create.mutate({
			text: trimmed,
			exerciseId: props.exerciseId,
			...(stars === undefined ? {} : { rating: starsToRating(stars) }),
		});
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
			<div className="flex flex-wrap items-center justify-between gap-3">
				<StarRating stars={stars} label="Rating" onChange={setStars} />
				<Button onClick={save} disabled={trimmed === "" || create.isPending}>
					{create.isPending ? "Saving…" : "Save note"}
				</Button>
			</div>
			{message === undefined ? null : <StatusMessage tone="error">{message}</StatusMessage>}
		</div>
	);
}

function NoteEditor(props: {
	readonly note: Note;
	readonly onCancel: () => void;
	readonly onChanged: () => void;
}) {
	const inputId = useId();
	const [text, setText] = useState(props.note.text ?? "");
	const [stars, setStars] = useState(ratingToStars(props.note.rating) ?? undefined);
	const update = useRyotMutation(updateNoteMutation);
	const { onChanged } = props;
	useEffect(() => {
		if (update.data !== undefined) {
			onChanged();
		}
	}, [update.data, onChanged]);
	const trimmed = text.trim();
	const save = () =>
		update.mutate({
			text: trimmed,
			noteId: props.note.id,
			rating: stars === undefined ? null : starsToRating(stars),
		});
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
			<StarRating stars={stars} label="Rating" onChange={setStars} />
			<div className="flex gap-2">
				<Button onClick={save} disabled={trimmed === "" || update.isPending}>
					{update.isPending ? "Saving…" : "Save"}
				</Button>
				<Button variant="secondary" onClick={props.onCancel} disabled={update.isPending}>
					Cancel
				</Button>
			</div>
			{message === undefined ? null : <StatusMessage tone="error">{message}</StatusMessage>}
		</div>
	);
}

function DeleteNoteConfirmation(props: {
	readonly noteId: string;
	readonly onClose: () => void;
	readonly onDeleted: () => void;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const { onDeleted } = props;
	const remove = useRyotMutation(deleteNoteMutation);
	useEffect(() => {
		if (remove.data !== undefined) {
			onDeleted();
		}
	}, [remove.data, onDeleted]);
	return (
		<DestructiveConfirmation
			title="Delete note?"
			onClose={props.onClose}
			pendingLabel="Deleting…"
			actionLabel="Delete note"
			pending={remove.isPending}
			triggerRef={props.triggerRef}
			errorMessage={failureMessage(remove.error)}
			detail="This private note will be removed permanently."
			onConfirm={() => remove.mutate({ noteId: props.noteId })}
		/>
	);
}

function NoteRow(props: { readonly note: Note; readonly onChanged: () => void }) {
	const { note, onChanged } = props;
	const deleteTrigger = useRef<HTMLButtonElement>(null);
	const [editing, setEditing] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const hasText = note.text !== null && note.text.trim() !== "";
	if (editing) {
		return (
			<li className="rounded-lg border border-border bg-surface-2 p-3">
				<NoteEditor
					note={note}
					onCancel={() => setEditing(false)}
					onChanged={() => {
						setEditing(false);
						onChanged();
					}}
				/>
			</li>
		);
	}
	return (
		<li className="flex flex-col gap-2 rounded-lg border border-border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-text-muted">
				<span>{formatShortDate(note.occurredAt, null)}</span>
				{note.rating === null ? null : <Stars rating={note.rating} />}
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
					onDeleted={() => {
						setConfirming(false);
						onChanged();
					}}
				/>
			) : null}
		</li>
	);
}

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
	readonly onChanged: () => void;
	readonly notes: ExerciseDetails["notes"];
	readonly focusRequest: number;
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
				focusRequest={props.focusRequest}
				onSaved={() => {
					setComposerKey((key) => key + 1);
					props.onChanged();
				}}
			/>
			{props.notes.length === 0 ? null : (
				<ul className="flex flex-col gap-3">
					{props.notes.map((note) => (
						<NoteRow note={note} key={note.id} onChanged={props.onChanged} />
					))}
				</ul>
			)}
			<WorkoutNotes notes={props.workoutNotes} />
		</section>
	);
}
