import {
	createRyotBackgroundSubmission,
	type RyotSubmission,
	useBackgroundSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import {
	ActionForm,
	Button,
	Dialog,
	Row,
	StatusMessage,
	Switch,
	TextArea,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type RefObject, useId, useRef, useState } from "react";

import { mediaReviewPatchableKeys } from "../../shared/media-activity-fields";
import {
	type MediaReviewContent,
	MediaReviewCreateInput,
	MediaReviewDeleteInput,
	MediaReviewUpdateInput,
} from "../../shared/media-review-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { eventPrecondition } from "./activity-log/state";
import type { MediaActivityEventRef } from "./activity-timeline";

const createReview = createRyotBackgroundSubmission({
	label: () => "Review",
	slug: "media-review-create",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: MediaReviewCreateInput,
	input: ({ input }: { readonly input: MediaReviewCreateInput }) => input,
});

const updateReview = createRyotBackgroundSubmission({
	label: () => "Edit review",
	slug: "media-review-update",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: MediaReviewUpdateInput,
	input: ({
		input,
		submittedAt,
		submissionId,
	}: RyotSubmission<Omit<MediaReviewUpdateInput, "submittedAt" | "submissionId">>) => ({
		...input,
		submittedAt,
		submissionId,
	}),
});

export const deleteReviewSubmission = createRyotBackgroundSubmission({
	slug: "media-review-delete",
	label: () => "Delete review",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: MediaReviewDeleteInput,
	input: ({ input, submittedAt, submissionId }: RyotSubmission<{ readonly eventId: string }>) => ({
		submittedAt,
		submissionId,
		eventId: input.eventId,
	}),
});

function MediaReviewComposer(props: {
	readonly title: string;
	readonly onClose: () => void;
	readonly isSending: boolean;
	readonly failed: boolean;
	readonly initial?: typeof MediaReviewContent.Type;
	readonly onSave: (review: typeof MediaReviewContent.Type) => void;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const id = useId();
	const ratingRef = useRef<HTMLInputElement>(null);
	const [text, setText] = useState(props.initial?.text ?? "");
	const [rating, setRating] = useState(
		props.initial?.rating == null ? "" : String(props.initial.rating),
	);
	const [isSpoiler, setIsSpoiler] = useState(props.initial?.isSpoiler ?? false);
	const { onClose, isSending } = props;
	const ratingValue = rating.trim() === "" ? undefined : Number(rating);
	const validRating =
		ratingValue === undefined ||
		(Number.isFinite(ratingValue) && ratingValue >= 0 && ratingValue <= 100);
	const hasText = text.trim().length > 0;
	const hasContent = hasText || ratingValue !== undefined;
	const canSave = hasContent && validRating && !isSending;
	const save = () => {
		if (!canSave) {
			return;
		}
		props.onSave({
			rating: ratingValue ?? null,
			isSpoiler: hasText && isSpoiler,
			text: hasText ? text.trim() : null,
		});
	};
	return (
		<Dialog
			onClose={onClose}
			title={props.title}
			dismissible={!isSending}
			closeLabel="Close review"
			initialFocusRef={ratingRef}
			triggerRef={props.triggerRef}
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
				{props.failed ? (
					<StatusMessage tone="error">Couldn't start saving your review. Try again.</StatusMessage>
				) : null}
				<div className="flex gap-2">
					<Button type="button" onClick={save} disabled={!canSave}>
						{isSending ? "Saving…" : "Save review"}
					</Button>
					<Button type="button" onClick={onClose} variant="secondary" disabled={isSending}>
						Cancel
					</Button>
				</div>
			</ActionForm>
		</Dialog>
	);
}

export function MediaReviewForm(props: {
	readonly entityId: string;
	readonly onClose: () => void;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const review = useBackgroundSubmission(createReview);
	return (
		<MediaReviewComposer
			title="Rate or review"
			onClose={props.onClose}
			isSending={review.isSending}
			triggerRef={props.triggerRef}
			failed={review.error !== null}
			onSave={(draft) =>
				review.submit({ ...draft, entityId: props.entityId }, { onAccepted: props.onClose })
			}
		/>
	);
}

export function MediaReviewEditForm(props: {
	readonly onClose: () => void;
	readonly record: MediaActivityEventRef;
	readonly initial: typeof MediaReviewContent.Type;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const review = useBackgroundSubmission(updateReview);
	return (
		<MediaReviewComposer
			title="Edit review"
			initial={props.initial}
			onClose={props.onClose}
			isSending={review.isSending}
			triggerRef={props.triggerRef}
			failed={review.error !== null}
			onSave={(draft) =>
				review.submit(
					{
						...draft,
						eventId: props.record.id,
						expected: eventPrecondition(props.record, mediaReviewPatchableKeys),
					},
					{ onAccepted: props.onClose },
				)
			}
		/>
	);
}

export function MediaReviewButton(props: { readonly entityId: string; readonly link?: boolean }) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	return (
		<>
			{props.link ? (
				<Button variant="link" ref={triggerRef} onClick={() => setOpen(true)}>
					Rate or review
				</Button>
			) : (
				<Button ref={triggerRef} variant="secondary" onClick={() => setOpen(true)}>
					<AppIcon size={15} name="star" />
					Rate or review
				</Button>
			)}
			{open ? (
				<MediaReviewForm
					triggerRef={triggerRef}
					entityId={props.entityId}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
	);
}
