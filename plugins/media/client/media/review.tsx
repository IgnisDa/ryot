import { type ReviewContent, reviewPropertyKeys } from "@ryot-app/plugin-client-sdk";
import {
	createRyotBackgroundSubmission,
	type RyotSubmission,
	useBackgroundSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, ReviewComposer } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type RefObject, useRef, useState } from "react";

import {
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

export function MediaReviewForm(props: {
	readonly entityId: string;
	readonly onClose: () => void;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const review = useBackgroundSubmission(createReview);
	return (
		<ReviewComposer
			title="Rate or review"
			onClose={props.onClose}
			isSending={review.isSending}
			triggerRef={props.triggerRef}
			errorMessage={
				review.error === null ? undefined : "Couldn't start saving your review. Try again."
			}
			onSave={(draft) =>
				review.submit({ ...draft, entityId: props.entityId }, { onAccepted: props.onClose })
			}
		/>
	);
}

export function MediaReviewButton(props: { readonly link?: boolean; readonly entityId: string }) {
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

export function MediaReviewEditForm(props: {
	readonly onClose: () => void;
	readonly initial: ReviewContent;
	readonly record: MediaActivityEventRef;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const review = useBackgroundSubmission(updateReview);
	return (
		<ReviewComposer
			title="Edit review"
			initial={props.initial}
			onClose={props.onClose}
			isSending={review.isSending}
			triggerRef={props.triggerRef}
			errorMessage={
				review.error === null ? undefined : "Couldn't start saving your review. Try again."
			}
			onSave={(draft) =>
				review.submit(
					{
						...draft,
						eventId: props.record.id,
						expected: eventPrecondition(props.record, reviewPropertyKeys),
					},
					{ onAccepted: props.onClose },
				)
			}
		/>
	);
}
