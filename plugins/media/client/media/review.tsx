import { type ReviewContent, reviewPropertyKeys } from "@ryot-app/plugin-client-sdk";
import {
	createRyotBackgroundSubmission,
	type RyotSubmission,
	useBackgroundSubmission,
	useUserPreferences,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, ReviewComposer } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type RefObject, useRef, useState } from "react";

import type { MediaPosition } from "../../shared/consumption";
import {
	MediaReviewCreateInput,
	MediaReviewDeleteInput,
	MediaReviewUpdateInput,
} from "../../shared/media-review-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { eventPrecondition, type MediaActivityLogger } from "./activity-log/state";
import type { MediaActivityEventRef } from "./activity-timeline";
import { ReviewSubjectPicker } from "./review-subject";
import {
	positionalReviewSubject,
	reviewSubjectModes,
	reviewTarget,
	WHOLE_REVIEW_SUBJECT,
} from "./review-subject-state";

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

type FixedReviewSubject = { readonly label: string; readonly entityId: string };

export function MediaChildReviewButton(props: FixedReviewSubject) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	return (
		<>
			<Button ref={triggerRef} variant="secondary" onClick={() => setOpen(true)}>
				<AppIcon size={15} name="star" />
				Review
			</Button>
			{open ? (
				<MediaReviewForm
					fixed={props}
					triggerRef={triggerRef}
					entityId={props.entityId}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
	);
}

export function MediaReviewButton(props: {
	readonly link?: boolean;
	readonly entityId: string;
	readonly logger?: undefined | MediaActivityLogger;
}) {
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
					logger={props.logger}
					triggerRef={triggerRef}
					entityId={props.entityId}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
	);
}

export function MediaReviewForm(props: {
	readonly entityId: string;
	readonly onClose: () => void;
	readonly fixed?: undefined | FixedReviewSubject;
	readonly logger?: undefined | MediaActivityLogger;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const review = useBackgroundSubmission(createReview);
	const scale = useUserPreferences().data?.ratingScale;
	const [subject, setSubject] = useState(WHOLE_REVIEW_SUBJECT);
	if (scale === undefined) {
		return null;
	}
	const target =
		props.fixed === undefined
			? reviewTarget(props.entityId, subject)
			: { entityId: props.entityId };
	let picker = null;
	if (props.fixed !== undefined) {
		picker = <FixedSubject label={props.fixed.label} />;
	} else if (props.logger !== undefined && reviewSubjectModes(props.logger).length > 0) {
		picker = (
			<ReviewSubjectPicker
				draft={subject}
				onChange={setSubject}
				logger={props.logger}
				entityId={props.entityId}
			/>
		);
	}
	return (
		<ReviewComposer
			scale={scale}
			subject={picker}
			title="Rate or review"
			onClose={props.onClose}
			isSending={review.isSending}
			triggerRef={props.triggerRef}
			canSave={target !== undefined}
			errorMessage={
				review.error === null ? undefined : "Couldn't start saving your review. Try again."
			}
			onSave={(draft) =>
				target === undefined
					? undefined
					: review.submit({ ...draft, ...target }, { onAccepted: props.onClose })
			}
		/>
	);
}

export function MediaReviewEditForm(props: {
	readonly entityId: string;
	readonly onClose: () => void;
	readonly initial: ReviewContent;
	readonly record: MediaActivityEventRef;
	readonly subjectLabel?: string | undefined;
	readonly position?: undefined | MediaPosition;
	readonly logger?: undefined | MediaActivityLogger;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const review = useBackgroundSubmission(updateReview);
	const scale = useUserPreferences().data?.ratingScale;
	const [subject, setSubject] = useState(() => positionalReviewSubject(props.position));
	if (scale === undefined) {
		return null;
	}
	const { logger } = props;
	const positional =
		props.subjectLabel === undefined && logger !== undefined && logger.family === "positional";
	const target = reviewTarget(props.entityId, subject);
	let picker = null;
	if (props.subjectLabel !== undefined) {
		picker = <FixedSubject label={props.subjectLabel} />;
	} else if (positional) {
		picker = (
			<ReviewSubjectPicker
				draft={subject}
				logger={logger}
				onChange={setSubject}
				entityId={props.entityId}
			/>
		);
	}
	return (
		<ReviewComposer
			scale={scale}
			subject={picker}
			title="Edit review"
			initial={props.initial}
			onClose={props.onClose}
			isSending={review.isSending}
			triggerRef={props.triggerRef}
			canSave={!positional || target !== undefined}
			errorMessage={
				review.error === null ? undefined : "Couldn't start saving your review. Try again."
			}
			onSave={(draft) =>
				review.submit(
					{
						...draft,
						eventId: props.record.id,
						...(positional ? { position: target?.position ?? null } : {}),
						expected: eventPrecondition(props.record, [
							...reviewPropertyKeys,
							...(positional ? ["position"] : []),
						]),
					},
					{ onAccepted: props.onClose },
				)
			}
		/>
	);
}

function FixedSubject(props: { readonly label: string }) {
	return (
		<p className="text-label text-text-muted">
			Review of <span className="font-medium text-text">{props.label}</span>
		</p>
	);
}
