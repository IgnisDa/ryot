import {
	type LocalMessage,
	type PluginUserPreferences,
	type ReviewContent,
	reviewPropertyKeys,
} from "@ryot-app/plugin-client-sdk";
import {
	createRyotBackgroundSubmission,
	PreferencesGate,
	type RyotSubmission,
	useBackgroundSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, ReviewComposer } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type ReactNode, type RefObject, useRef, useState } from "react";

import type { MediaPosition } from "../../shared/consumption";
import {
	MediaReviewCreateInput,
	MediaReviewDeleteInput,
	MediaReviewUpdateInput,
} from "../../shared/media-review-operations";
import { catalogMessage } from "../../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { useMediaMessages } from "../messages";
import { eventPrecondition, type MediaActivityLogger } from "./activity-log/state";
import type { MediaActivityEventRef } from "./activity-timeline";
import { linkedOccurrenceId, ReviewAboutSelect, type ReviewCompletion } from "./review-about";
import { ReviewSubjectPicker } from "./review-subject";
import {
	positionalReviewSubject,
	reviewSubjectModes,
	reviewTarget,
	WHOLE_REVIEW_SUBJECT,
} from "./review-subject-state";

type Labeled<Input> = Input & { readonly label: LocalMessage };

const createReview = createRyotBackgroundSubmission({
	slug: "media-review-create",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: MediaReviewCreateInput,
	label: (input: Labeled<MediaReviewCreateInput>) => input.label,
	input: ({
		input: { label: _label, ...input },
	}: RyotSubmission<Labeled<MediaReviewCreateInput>>) => input,
});

const updateReview = createRyotBackgroundSubmission({
	slug: "media-review-update",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: MediaReviewUpdateInput,
	label: (input: Labeled<Omit<MediaReviewUpdateInput, "submittedAt" | "submissionId">>) =>
		input.label,
	input: ({
		submittedAt,
		submissionId,
		input: { label: _label, ...input },
	}: RyotSubmission<Labeled<Omit<MediaReviewUpdateInput, "submittedAt" | "submissionId">>>) => ({
		...input,
		submittedAt,
		submissionId,
	}),
});

export const deleteReviewSubmission = createRyotBackgroundSubmission({
	slug: "media-review-delete",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: MediaReviewDeleteInput,
	label: (input: Labeled<{ readonly eventId: string }>) => input.label,
	input: ({
		input,
		submittedAt,
		submissionId,
	}: RyotSubmission<Labeled<{ readonly eventId: string }>>) => ({
		submittedAt,
		submissionId,
		eventId: input.eventId,
	}),
});

type FixedReviewSubject = { readonly entityId: string; readonly label: string | LocalMessage };

type MediaReviewFormProps = {
	readonly entityId: string;
	readonly onClose: () => void;
	readonly fixed?: undefined | FixedReviewSubject;
	readonly logger?: undefined | MediaActivityLogger;
	readonly completion?: undefined | ReviewCompletion;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
};

type MediaReviewEditFormProps = {
	readonly entityId: string;
	readonly onClose: () => void;
	readonly initial: ReviewContent;
	readonly record: MediaActivityEventRef;
	readonly position?: undefined | MediaPosition;
	readonly subjectLabel?: undefined | LocalMessage;
	readonly logger?: undefined | MediaActivityLogger;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
};

export function MediaReviewForm(props: MediaReviewFormProps) {
	return (
		<PreferencesGate>
			{({ ratingScale }) => <MediaReviewFormBody {...props} scale={ratingScale} />}
		</PreferencesGate>
	);
}

export function MediaReviewEditForm(props: MediaReviewEditFormProps) {
	return (
		<PreferencesGate>
			{({ ratingScale }) => <MediaReviewEditFormBody {...props} scale={ratingScale} />}
		</PreferencesGate>
	);
}

export function MediaChildReviewButton(props: FixedReviewSubject) {
	const text = useMediaMessages();
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	return (
		<>
			<Button ref={triggerRef} variant="secondary" onClick={() => setOpen(true)}>
				<AppIcon size={15} name="star" />
				{text("review.button")}
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
	const text = useMediaMessages();
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	return (
		<>
			{props.link ? (
				<Button variant="link" ref={triggerRef} onClick={() => setOpen(true)}>
					{text("review.rate-or-review")}
				</Button>
			) : (
				<Button ref={triggerRef} variant="secondary" onClick={() => setOpen(true)}>
					<AppIcon size={15} name="star" />
					{text("review.rate-or-review")}
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

function ReviewSubjectAndAbout(props: {
	readonly picker: ReactNode;
	readonly children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3">
			{props.picker}
			{props.children}
		</div>
	);
}

function FixedSubject(props: { readonly label: string | LocalMessage }) {
	const text = useMediaMessages();
	return (
		<p className="text-label text-text-muted">{text("review.of", { subject: props.label })}</p>
	);
}

function MediaReviewFormBody(
	props: MediaReviewFormProps & { readonly scale: PluginUserPreferences["ratingScale"] },
) {
	const text = useMediaMessages();
	const review = useBackgroundSubmission(createReview);
	const { scale } = props;
	const [subject, setSubject] = useState(WHOLE_REVIEW_SUBJECT);
	const [about, setAbout] = useState<null | string>(null);
	const target =
		props.fixed === undefined
			? reviewTarget(props.entityId, subject)
			: { entityId: props.entityId };
	let picker = null;
	if (props.fixed !== undefined) {
		picker = <FixedSubject label={props.fixed.label} />;
	} else if (props.logger !== undefined && reviewSubjectModes(text, props.logger).length > 0) {
		picker = (
			<ReviewSubjectPicker
				draft={subject}
				logger={props.logger}
				entityId={props.entityId}
				onChange={(next) => {
					setSubject(next);
					setAbout(null);
				}}
			/>
		);
	}
	return (
		<ReviewComposer
			scale={scale}
			onClose={props.onClose}
			isSending={review.isSending}
			triggerRef={props.triggerRef}
			canSave={target !== undefined}
			title={text("review.rate-or-review")}
			errorMessage={review.error === null ? undefined : text("review.save-failed")}
			onSave={(draft) =>
				target === undefined
					? undefined
					: review.submit(
							{
								...draft,
								...target,
								label: catalogMessage("review.label"),
								...(about === null ? {} : { consumptionEventId: about }),
							},
							{ onAccepted: props.onClose },
						)
			}
			subject={
				<ReviewSubjectAndAbout picker={picker}>
					{target === undefined ? null : (
						<ReviewAboutSelect
							value={about}
							onChange={setAbout}
							key={target.entityId}
							entityId={target.entityId}
							completion={props.completion}
						/>
					)}
				</ReviewSubjectAndAbout>
			}
		/>
	);
}

function MediaReviewEditFormBody(
	props: MediaReviewEditFormProps & { readonly scale: PluginUserPreferences["ratingScale"] },
) {
	const text = useMediaMessages();
	const review = useBackgroundSubmission(updateReview);
	const { scale } = props;
	const [subject, setSubject] = useState(() => positionalReviewSubject(props.position));
	const [about, setAbout] = useState(() => linkedOccurrenceId(props.record));
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
			initial={props.initial}
			onClose={props.onClose}
			title={text("review.edit")}
			isSending={review.isSending}
			triggerRef={props.triggerRef}
			canSave={!positional || target !== undefined}
			errorMessage={review.error === null ? undefined : text("review.save-failed")}
			subject={
				<ReviewSubjectAndAbout picker={picker}>
					<ReviewAboutSelect value={about} onChange={setAbout} entityId={props.record.entityId} />
				</ReviewSubjectAndAbout>
			}
			onSave={(draft) =>
				review.submit(
					{
						...draft,
						eventId: props.record.id,
						consumptionEventId: about,
						label: catalogMessage("review.edit"),
						...(positional ? { position: target?.position ?? null } : {}),
						expected: eventPrecondition(props.record, [
							...reviewPropertyKeys,
							"consumptionEventId",
							...(positional ? ["position"] : []),
						]),
					},
					{ onAccepted: props.onClose },
				)
			}
		/>
	);
}
