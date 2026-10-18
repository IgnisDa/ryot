import {
	createRyotBackgroundSubmission,
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

import { MediaReviewCreateInput } from "../../shared/media-review-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

const createReview = createRyotBackgroundSubmission({
	label: () => "Review",
	slug: "media-review-create",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: MediaReviewCreateInput,
	input: ({ input }: { readonly input: MediaReviewCreateInput }) => input,
});

export function MediaReviewForm(props: {
	readonly entityId: string;
	readonly onClose: () => void;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const id = useId();
	const textRef = useRef<HTMLTextAreaElement>(null);
	const [text, setText] = useState("");
	const [rating, setRating] = useState("");
	const [isSpoiler, setIsSpoiler] = useState(false);
	const review = useBackgroundSubmission(createReview);
	const { onClose } = props;
	const ratingValue = rating.trim() === "" ? undefined : Number(rating);
	const validRating =
		ratingValue === undefined ||
		(Number.isFinite(ratingValue) && ratingValue >= 0 && ratingValue <= 100);
	const save = () => {
		if (text.trim() === "" || !validRating || review.isSending) {
			return;
		}
		review.submit(
			{
				isSpoiler,
				text: text.trim(),
				entityId: props.entityId,
				...(ratingValue === undefined ? {} : { rating: ratingValue }),
			},
			{ onAccepted: onClose },
		);
	};
	return (
		<Dialog
			onClose={onClose}
			title="Write review"
			closeLabel="Close review"
			initialFocusRef={textRef}
			triggerRef={props.triggerRef}
			dismissible={!review.isSending}
		>
			<ActionForm onSubmit={save} label="Write review" className="flex flex-col gap-4">
				<label htmlFor={`${id}-text`}>Review</label>
				<TextArea
					rows={5}
					value={text}
					ref={textRef}
					id={`${id}-text`}
					disabled={review.isSending}
					onChange={(event) => setText(event.currentTarget.value)}
				/>
				<label htmlFor={`${id}-rating`}>Rating (0–100, optional)</label>
				<TextField
					type="text"
					value={rating}
					inputMode="decimal"
					id={`${id}-rating`}
					invalid={!validRating}
					disabled={review.isSending}
					onChange={(event) => setRating(event.currentTarget.value)}
					aria-describedby={validRating ? undefined : `${id}-rating-error`}
				/>
				{validRating ? null : (
					<StatusMessage tone="error" id={`${id}-rating-error`}>
						Enter a number from 0 to 100.
					</StatusMessage>
				)}
				<Row
					title="Contains spoilers"
					trailing={
						<Switch
							checked={isSpoiler}
							onChange={setIsSpoiler}
							label="Contains spoilers"
							disabled={review.isSending}
						/>
					}
				/>
				{review.error === null ? null : (
					<StatusMessage tone="error">Couldn't start saving your review. Try again.</StatusMessage>
				)}
				<div className="flex gap-2">
					<Button
						type="button"
						onClick={save}
						disabled={text.trim() === "" || !validRating || review.isSending}
					>
						{review.isSending ? "Saving…" : "Save review"}
					</Button>
					<Button type="button" onClick={onClose} variant="secondary" disabled={review.isSending}>
						Cancel
					</Button>
				</div>
			</ActionForm>
		</Dialog>
	);
}

export function MediaReviewButton(props: { readonly entityId: string; readonly link?: boolean }) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	return (
		<>
			{props.link ? (
				<Button variant="link" ref={triggerRef} onClick={() => setOpen(true)}>
					Write review
				</Button>
			) : (
				<Button ref={triggerRef} variant="secondary" onClick={() => setOpen(true)}>
					<AppIcon size={15} name="star" />
					Write review
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
