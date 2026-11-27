import { useBackgroundSubmission } from "@ryot-app/plugin-client-sdk/react";
import { DestructiveConfirmation, MenuButton } from "@ryot-app/plugin-ui-sdk";
import { createContext, type RefObject, useContext, useRef, useState } from "react";

import { mediaActivityPatchableKeys } from "../../shared/media-activity-fields";
import { catalogMessage } from "../../shared/messages.generated";
import { type MediaText, useMediaMessages } from "../messages";
import { MediaActivityEditSheet } from "./activity-log/edit-sheet";
import { deleteActivitySubmission } from "./activity-log/queries";
import {
	type ActivityEditIntent,
	eventPrecondition,
	type MediaActivityLogger,
} from "./activity-log/state";
import type {
	MediaActivityEventRef,
	MediaActivityReviewRow,
	MediaActivityRowBase,
} from "./activity-timeline";
import { deleteReviewSubmission, MediaReviewEditForm } from "./review";

type MediaActivityActions = {
	readonly entityId: string;
	readonly compact: boolean;
	readonly logger: undefined | MediaActivityLogger;
};

export const MediaActivityActionsContext = createContext<undefined | MediaActivityActions>(
	undefined,
);

const EDIT_INTENTS: Partial<Record<string, ActivityEditIntent>> = {
	item: "finished",
	watch: "episode",
	progress: "progress",
	completion: "finished",
};

const isReviewRow = (row: MediaActivityRowBase): row is MediaActivityReviewRow<unknown> =>
	row.type === "review" && "event" in row;

const failureMessage = (text: MediaText, error: null | Error) =>
	error === null ? undefined : text("record.delete-failed");

/** Edit and delete for a row that maps to stored records; rows without records get nothing. */
export function MediaActivityRowMenu(props: { readonly row: MediaActivityRowBase }) {
	const { row } = props;
	const text = useMediaMessages();
	const actions = useContext(MediaActivityActionsContext);
	const triggerRef = useRef<null | HTMLButtonElement>(null);
	const [open, setOpen] = useState<"edit" | "delete" | undefined>(undefined);
	const events = row.events ?? [];
	const [only] = events;
	if (actions === undefined || only === undefined) {
		return null;
	}
	const review = isReviewRow(row) ? row : undefined;
	const intent = events.length - (row.absorbed ?? 0) === 1 ? EDIT_INTENTS[row.type] : undefined;
	const { logger } = actions;
	const editable = review !== undefined || (intent !== undefined && logger !== undefined);
	const close = () => setOpen(undefined);
	return (
		<>
			<MenuButton
				triggerRef={triggerRef}
				label={text("record.actions")}
				items={[
					...(editable
						? [{ key: "edit", label: text("record.edit"), onSelect: () => setOpen("edit") }]
						: []),
					{
						key: "delete",
						destructive: true,
						onSelect: () => setOpen("delete"),
						label: text("common.action.delete"),
					},
				]}
			/>
			{open === "delete" && review !== undefined ? (
				<DeleteReview onClose={close} triggerRef={triggerRef} eventId={review.event.id} />
			) : null}
			{open === "delete" && review === undefined ? (
				<DeleteRecords events={events} onClose={close} triggerRef={triggerRef} />
			) : null}
			{open === "edit" && review !== undefined ? (
				<MediaReviewEditForm
					onClose={close}
					logger={logger}
					record={review.event}
					triggerRef={triggerRef}
					position={review.position}
					entityId={actions.entityId}
					subjectLabel={review.subjectLabel}
					initial={{
						rating: review.rating ?? null,
						text: review.body?.text ?? null,
						isSpoiler: review.body?.isSpoiler ?? false,
					}}
				/>
			) : null}
			{open === "edit" && review === undefined && intent !== undefined && logger !== undefined ? (
				<MediaActivityEditSheet
					record={only}
					intent={intent}
					logger={logger}
					onClose={close}
					triggerRef={triggerRef}
					compact={actions.compact}
					entityId={actions.entityId}
				/>
			) : null}
		</>
	);
}

function DeleteReview(props: {
	readonly eventId: string;
	readonly onClose: () => void;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const text = useMediaMessages();
	const remove = useBackgroundSubmission(deleteReviewSubmission);
	return (
		<DestructiveConfirmation
			onClose={props.onClose}
			pending={remove.isSending}
			triggerRef={props.triggerRef}
			title={text("record.delete-review-title")}
			actionLabel={text("record.delete-review")}
			detail={text("record.delete-review-detail")}
			pendingLabel={text("common.status.deleting")}
			errorMessage={failureMessage(text, remove.error)}
			onConfirm={() =>
				remove.submit(
					{ eventId: props.eventId, label: catalogMessage("record.delete-review") },
					{ onAccepted: props.onClose },
				)
			}
		/>
	);
}

function DeleteRecords(props: {
	readonly onClose: () => void;
	readonly events: readonly MediaActivityEventRef[];
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const text = useMediaMessages();
	const remove = useBackgroundSubmission(deleteActivitySubmission);
	const [only] = props.events;
	const count = props.events.length;
	return (
		<DestructiveConfirmation
			onClose={props.onClose}
			pending={remove.isSending}
			triggerRef={props.triggerRef}
			pendingLabel={text("common.status.deleting")}
			errorMessage={failureMessage(text, remove.error)}
			actionLabel={text("record.delete-records", { count })}
			title={text("record.delete-records-title", { count })}
			detail={text("record.delete-records-detail", { count })}
			onConfirm={() =>
				remove.submit(
					{
						eventIds: props.events.map(({ id }) => id),
						label: catalogMessage("record.delete-records", { count }),
						...(count === 1 && only !== undefined
							? { expected: eventPrecondition(only, mediaActivityPatchableKeys) }
							: {}),
					},
					{ onAccepted: props.onClose },
				)
			}
		/>
	);
}
