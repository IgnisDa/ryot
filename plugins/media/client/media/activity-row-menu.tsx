import { useBackgroundSubmission } from "@ryot-app/plugin-client-sdk/react";
import { DestructiveConfirmation, IconButton, MenuButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { createContext, type RefObject, useContext, useRef, useState } from "react";

import { mediaActivityPatchableKeys } from "../../shared/media-activity-fields";
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

export type MediaActivityActions = {
	readonly entityId: string;
	readonly compact: boolean;
	readonly logger: MediaActivityLogger | undefined;
};

export const MediaActivityActionsContext = createContext<MediaActivityActions | undefined>(
	undefined,
);

const EDIT_INTENTS: Partial<Record<string, ActivityEditIntent>> = {
	watch: "episode",
	progress: "progress",
	completion: "finished",
};

const isReviewRow = (row: MediaActivityRowBase): row is MediaActivityReviewRow<unknown> =>
	row.type === "review" && "event" in row;

const failureMessage = (error: Error | null) =>
	error === null ? undefined : "Couldn't start deleting. Try again.";

function DeleteRecords(props: {
	readonly onClose: () => void;
	readonly events: readonly MediaActivityEventRef[];
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const remove = useBackgroundSubmission(deleteActivitySubmission);
	const [only] = props.events;
	const count = props.events.length;
	return (
		<DestructiveConfirmation
			onClose={props.onClose}
			pendingLabel="Deleting…"
			pending={remove.isSending}
			triggerRef={props.triggerRef}
			errorMessage={failureMessage(remove.error)}
			actionLabel={count === 1 ? "Delete record" : `Delete ${count} records`}
			title={count === 1 ? "Delete this record?" : `Delete ${count} records?`}
			detail={
				count === 1
					? "This record will be removed from your history permanently."
					: `This row stands for ${count} records. All of them will be removed from your history permanently.`
			}
			onConfirm={() =>
				remove.submit(
					{
						eventIds: props.events.map(({ id }) => id),
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

function DeleteReview(props: {
	readonly eventId: string;
	readonly onClose: () => void;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const remove = useBackgroundSubmission(deleteReviewSubmission);
	return (
		<DestructiveConfirmation
			onClose={props.onClose}
			pendingLabel="Deleting…"
			pending={remove.isSending}
			title="Delete this review?"
			actionLabel="Delete review"
			triggerRef={props.triggerRef}
			errorMessage={failureMessage(remove.error)}
			detail="This review will be removed permanently."
			onConfirm={() => remove.submit({ eventId: props.eventId }, { onAccepted: props.onClose })}
		/>
	);
}

/** Edit and delete for a row that maps to stored records; rows without records get nothing. */
export function MediaActivityRowMenu(props: { readonly row: MediaActivityRowBase }) {
	const { row } = props;
	const actions = useContext(MediaActivityActionsContext);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const [open, setOpen] = useState<"edit" | "delete" | undefined>(undefined);
	const events = row.events ?? [];
	const [only] = events;
	if (actions === undefined || only === undefined) {
		return null;
	}
	const review = isReviewRow(row) ? row : undefined;
	const intent = events.length === 1 ? EDIT_INTENTS[row.type] : undefined;
	const { logger } = actions;
	const editable = review !== undefined || (intent !== undefined && logger !== undefined);
	const close = () => setOpen(undefined);
	return (
		<>
			<MenuButton
				label="Record actions"
				items={[
					...(editable ? [{ key: "edit", label: "Edit", onSelect: () => setOpen("edit") }] : []),
					{ key: "delete", label: "Delete", destructive: true, onSelect: () => setOpen("delete") },
				]}
				renderTrigger={(trigger) => (
					<IconButton
						size="sm"
						label="Record actions"
						onClick={trigger.onClick}
						aria-haspopup={trigger["aria-haspopup"]}
						aria-expanded={trigger["aria-expanded"]}
						ref={(element) => {
							triggerRef.current = element;
							trigger.ref(element);
						}}
					>
						<AppIcon size={16} name="more-horizontal" />
					</IconButton>
				)}
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
					record={review.event}
					triggerRef={triggerRef}
					initial={{
						text: review.body?.text ?? "",
						isSpoiler: review.body?.isSpoiler ?? false,
						...(review.rating === undefined ? {} : { rating: review.rating }),
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
