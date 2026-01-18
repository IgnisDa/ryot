import { Center, Loader, Stack, Text } from "@mantine/core";
import { EntityTranslationVariant } from "@ryot/generated/graphql/backend/graphql";
import { useMetadataDetails, useUserMetadataDetails } from "~/lib/shared/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import { MetadataInProgressUpdateForm } from "./in-progress-form";
import { MetadataNewProgressUpdateForm } from "./new-progress-form";

export const MetadataProgressUpdateForm = ({
	closeMetadataProgressUpdateModal,
}: {
	closeMetadataProgressUpdateModal: () => void;
}) => {
	const { metadataToUpdate } = useMetadataProgressUpdate();

	const [{ data: metadataDetails }, , useMetadataTranslationValue] =
		useMetadataDetails(metadataToUpdate?.metadataId);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		metadataToUpdate?.metadataId,
	);

	const metadataTitleTranslation = useMetadataTranslationValue({
		variant: EntityTranslationVariant.Title,
	});

	if (!metadataDetails || !metadataToUpdate || !userMetadataDetails)
		return (
			<Center p="lg">
				<Loader type="dots" />
			</Center>
		);

	const onSubmit = () => {
		closeMetadataProgressUpdateModal();
	};

	return (
		<Stack>
			<Text fw="bold" ta="center" truncate>
				{metadataTitleTranslation || metadataDetails.title}
			</Text>
			{userMetadataDetails.inProgress ? (
				<MetadataInProgressUpdateForm
					onSubmit={onSubmit}
					metadataDetails={metadataDetails}
					inProgress={userMetadataDetails.inProgress}
				/>
			) : (
				<MetadataNewProgressUpdateForm
					onSubmit={onSubmit}
					metadataDetails={metadataDetails}
					history={userMetadataDetails.history}
				/>
			)}
		</Stack>
	);
};
