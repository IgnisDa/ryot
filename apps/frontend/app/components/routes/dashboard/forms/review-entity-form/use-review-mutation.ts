import { notifications } from "@mantine/notifications";
import { CreateOrUpdateReviewDocument } from "@ryot/generated/graphql/backend/graphql";
import { useMutation } from "@tanstack/react-query";
import { useRevalidator } from "react-router";
import { useApplicationEvents } from "~/lib/shared/hooks";
import {
	clientGqlService,
	refreshEntityDetails,
} from "~/lib/shared/react-query";
import type { ReviewEntityData } from "~/lib/state/media";
import { type ReviewFormValues, prepareReviewInput } from "./helpers";

interface UseReviewMutationProps {
	closeModal: () => void;
	entityToReview: ReviewEntityData | null;
}

export const useReviewMutation = (props: UseReviewMutationProps) => {
	const revalidator = useRevalidator();
	const events = useApplicationEvents();

	const mutation = useMutation({
		mutationFn: (formValues: ReviewFormValues) => {
			const input = prepareReviewInput(formValues);
			return clientGqlService.request(CreateOrUpdateReviewDocument, { input });
		},
		onSuccess: () => {
			events.postReview(props.entityToReview?.entityTitle || "");
			revalidator.revalidate();
			refreshEntityDetails(props.entityToReview?.entityId || "");
			notifications.show({
				color: "green",
				message: props.entityToReview?.existingReview?.id
					? "Your review has been updated"
					: "Your review has been created",
			});
			props.closeModal();
		},
	});

	return mutation;
};
