import {
	requireReviewContent,
	ReviewContent,
	type ReviewProperties,
	ReviewRating,
} from "@ryot-app/contract/modules/events/review";
import { Schema } from "effect";
import { type RefObject, useId, useRef, useState } from "react";

import { ActionForm } from "./action-form";
import { Button } from "./button";
import { DestructiveConfirmation } from "./destructive-confirmation";
import { Dialog } from "./dialog";
import { StatusMessage } from "./status-message";
import { Row } from "./surface";
import { Switch } from "./switch";
import { TextArea, TextField } from "./text-field";

const isReviewRating = Schema.is(ReviewRating);
const isReviewContent = Schema.is(ReviewContent.pipe(Schema.check(requireReviewContent)));

export function ReviewComposer(props: {
	readonly title: string;
	readonly isSending: boolean;
	readonly onClose: () => void;
	readonly errorMessage?: string | undefined;
	readonly onDelete?: undefined | (() => void);
	readonly onSave: (review: ReviewContent) => void;
	readonly initial?: undefined | typeof ReviewProperties.Type;
	readonly triggerRef?: undefined | RefObject<null | HTMLButtonElement>;
}) {
	const id = useId();
	const [deletion, setDeletion] = useState<"closed" | "submitted" | "confirming">("closed");
	const deleteTrigger = useRef<HTMLButtonElement>(null);
	const ratingRef = useRef<HTMLInputElement>(null);
	const [text, setText] = useState(props.initial?.text ?? "");
	const [rating, setRating] = useState(
		props.initial?.rating == null ? "" : String(props.initial.rating),
	);
	const [isSpoiler, setIsSpoiler] = useState(props.initial?.isSpoiler ?? false);
	const { onClose, isSending } = props;
	const ratingValue = rating.trim() === "" ? undefined : Number(rating);
	const validRating = ratingValue === undefined || isReviewRating(ratingValue);
	const hasText = text.trim().length > 0;
	const draft = {
		rating: ratingValue ?? null,
		isSpoiler: hasText && isSpoiler,
		text: hasText ? text.trim() : null,
	};
	const hasContent = hasText || ratingValue !== undefined;
	const canSave = isReviewContent(draft) && !isSending;
	const save = () => {
		if (canSave) {
			props.onSave(draft);
		}
	};
	return (
		<Dialog
			onClose={onClose}
			title={props.title}
			dismissible={!isSending}
			closeLabel="Close review"
			initialFocusRef={ratingRef}
			{...(props.triggerRef === undefined ? {} : { triggerRef: props.triggerRef })}
		>
			<ActionForm onSubmit={save} label={props.title} className="flex flex-col gap-4">
				<p className="text-label text-text-muted">Add a rating, a review, or both.</p>
				<label htmlFor={`${id}-rating`}>Rating (0–100, optional)</label>
				<TextField
					type="text"
					value={rating}
					ref={ratingRef}
					inputMode="decimal"
					id={`${id}-rating`}
					disabled={isSending}
					invalid={!validRating}
					onChange={(event) => setRating(event.currentTarget.value)}
					aria-describedby={validRating ? undefined : `${id}-rating-error`}
				/>
				{validRating ? null : (
					<StatusMessage tone="error" id={`${id}-rating-error`}>
						Enter a number from 0 to 100.
					</StatusMessage>
				)}
				<label htmlFor={`${id}-text`}>Review (optional)</label>
				<TextArea
					rows={5}
					value={text}
					id={`${id}-text`}
					disabled={isSending}
					onChange={(event) => setText(event.currentTarget.value)}
				/>
				{hasText ? (
					<Row
						title="Contains spoilers"
						trailing={
							<Switch
								checked={isSpoiler}
								disabled={isSending}
								onChange={setIsSpoiler}
								label="Contains spoilers"
							/>
						}
					/>
				) : null}
				{props.initial !== undefined && !hasContent ? (
					<StatusMessage tone="error">
						Keep a rating or review text, or delete this review.
					</StatusMessage>
				) : null}
				{props.errorMessage && !isSending ? (
					<StatusMessage tone="error">{props.errorMessage}</StatusMessage>
				) : null}
				<div className="flex flex-wrap gap-2">
					<Button type="button" onClick={save} disabled={!canSave}>
						{isSending ? "Saving…" : "Save review"}
					</Button>
					<Button type="button" onClick={onClose} variant="secondary" disabled={isSending}>
						Cancel
					</Button>
					{props.onDelete ? (
						<Button
							ref={deleteTrigger}
							disabled={isSending}
							variant="dangerGhost"
							onClick={() => setDeletion("confirming")}
						>
							Delete review
						</Button>
					) : null}
				</div>
			</ActionForm>
			{deletion !== "closed" && props.onDelete ? (
				<DestructiveConfirmation
					pending={isSending}
					pendingLabel="Deleting…"
					triggerRef={deleteTrigger}
					title="Delete this review?"
					actionLabel="Delete review"
					onClose={() => setDeletion("closed")}
					detail="This review will be permanently deleted."
					onConfirm={() => {
						setDeletion("submitted");
						props.onDelete?.();
					}}
					errorMessage={deletion === "submitted" && !isSending ? props.errorMessage : undefined}
				/>
			) : null}
		</Dialog>
	);
}
