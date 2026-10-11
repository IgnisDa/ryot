import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
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
import { type RefObject, useEffect, useId, useRef, useState } from "react";

import {
	MediaReviewCreateInput,
	MediaReviewCreateOutput,
} from "../../shared/media-review-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

const createReview = createRyotMutation<
	MediaReviewCreateInput,
	typeof MediaReviewCreateOutput.Type
>(({ input, client }) =>
	Effect.gen(function* () {
		const result = yield* client.operations.invoke({
			input,
			slug: "media-review-create",
			packageId: PLUGIN_PACKAGE_ID,
			output: MediaReviewCreateOutput,
			inputSchema: MediaReviewCreateInput,
		});
		if (result.count !== 1) {
			return yield* new RyotClientError("malformed-result");
		}
		return result;
	}),
);

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
	const mutation = useRyotMutation(createReview);
	const { onClose } = props;
	useEffect(() => {
		if (mutation.data !== undefined) {
			onClose();
		}
	}, [mutation.data, onClose]);
	const ratingValue = rating.trim() === "" ? undefined : Number(rating);
	const validRating =
		ratingValue === undefined ||
		(Number.isFinite(ratingValue) && ratingValue >= 0 && ratingValue <= 100);
	const save = () => {
		if (text.trim() === "" || !validRating || mutation.isPending) {
			return;
		}
		mutation.mutate({
			isSpoiler,
			text: text.trim(),
			entityId: props.entityId,
			...(ratingValue === undefined ? {} : { rating: ratingValue }),
		});
	};
	return (
		<Dialog
			onClose={onClose}
			title="Write review"
			closeLabel="Close review"
			initialFocusRef={textRef}
			triggerRef={props.triggerRef}
			dismissible={!mutation.isPending}
		>
			<ActionForm onSubmit={save} label="Write review" className="flex flex-col gap-4">
				<label htmlFor={`${id}-text`}>Review</label>
				<TextArea
					rows={5}
					value={text}
					ref={textRef}
					id={`${id}-text`}
					disabled={mutation.isPending}
					onChange={(event) => setText(event.currentTarget.value)}
				/>
				<label htmlFor={`${id}-rating`}>Rating (0–100, optional)</label>
				<TextField
					type="text"
					value={rating}
					inputMode="decimal"
					id={`${id}-rating`}
					invalid={!validRating}
					disabled={mutation.isPending}
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
							disabled={mutation.isPending}
						/>
					}
				/>
				{mutation.error === null ? null : (
					<StatusMessage tone="error">Unable to save your review. Try again.</StatusMessage>
				)}
				<div className="flex gap-2">
					<Button
						type="button"
						onClick={save}
						disabled={text.trim() === "" || !validRating || mutation.isPending}
					>
						{mutation.isPending ? "Saving…" : "Save review"}
					</Button>
					<Button type="button" onClick={onClose} variant="secondary" disabled={mutation.isPending}>
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
