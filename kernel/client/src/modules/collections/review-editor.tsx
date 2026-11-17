import type { RatingScale } from "@ryot-app/contract/modules/events/rating-scale";
import { EventNotFound, EventStale } from "@ryot-app/contract/modules/events/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { ReviewComposer } from "@ryot-app/plugin-ui-sdk";

import { AuthenticatedApiError } from "#/api/authenticated";

import { type CollectionReview, collectionReviewMutation, ReviewNotSaved } from "./review-service";

const failureMessage = (error: unknown): Message => {
	const cause = error instanceof AuthenticatedApiError ? error.cause : error;
	if (cause instanceof EventStale) {
		return kernelMessage("client.collections.reviews.failure.stale");
	}
	if (cause instanceof EventNotFound) {
		return kernelMessage("client.collections.reviews.failure.not-found");
	}
	if (cause instanceof ReviewNotSaved) {
		return kernelMessage("client.collections.reviews.failure.not-saved");
	}
	return kernelMessage("client.collections.reviews.failure.unconfirmed");
};

export function CollectionReviewEditor(props: {
	readonly scale: RatingScale;
	readonly onClose: () => void;
	readonly onSaved: () => void;
	readonly collectionId: EntityId;
	readonly initial: null | CollectionReview;
}) {
	const t = useT();
	const mutation = useRyotMutation(collectionReviewMutation);

	const initial = props.initial;
	return (
		<ReviewComposer
			scale={props.scale}
			onClose={props.onClose}
			initial={initial?.properties}
			isSending={mutation.isPending}
			errorMessage={mutation.error === null ? undefined : t(failureMessage(mutation.error))}
			title={t(
				kernelMessage(
					initial === null ? "client.collections.reviews.post" : "client.collections.reviews.edit",
				),
			)}
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
