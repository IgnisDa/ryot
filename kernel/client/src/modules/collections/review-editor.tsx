import { EventNotFound, EventStale } from "@ryot-app/contract/modules/events/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { ReviewComposer } from "@ryot-app/plugin-ui-sdk";

import { AuthenticatedApiError } from "#/api/authenticated";

import { type CollectionReview, collectionReviewMutation, ReviewNotSaved } from "./review-service";

const failureMessage = (error: unknown) => {
	const cause = error instanceof AuthenticatedApiError ? error.cause : error;
	if (cause instanceof EventStale) {
		return "This review changed elsewhere. Close and reopen it before saving.";
	}
	if (cause instanceof EventNotFound) {
		return "This review no longer exists. Close the editor to refresh the list.";
	}
	if (cause instanceof ReviewNotSaved) {
		return "The review was not saved. Check your review and try again.";
	}
	return "The result could not be confirmed. Your draft is still here. Check the review list before trying again.";
};

export function CollectionReviewEditor(props: {
	readonly onClose: () => void;
	readonly onSaved: () => void;
	readonly collectionId: EntityId;
	readonly initial: null | CollectionReview;
}) {
	const mutation = useRyotMutation(collectionReviewMutation);

	const initial = props.initial;
	return (
		<ReviewComposer
			onClose={props.onClose}
			initial={initial?.properties}
			isSending={mutation.isPending}
			title={initial === null ? "Post a review" : "Edit review"}
			errorMessage={mutation.error === null ? undefined : failureMessage(mutation.error)}
			onSave={(draft) =>
				mutation.mutate({
					onSaved: props.onSaved,
					command: { draft, initial, action: "save", collectionId: props.collectionId },
				})
			}
			onDelete={
				initial === null
					? undefined
					: () =>
							mutation.mutate({
								onSaved: props.onSaved,
								command: { action: "delete", eventId: initial.id },
							})
			}
		/>
	);
}
