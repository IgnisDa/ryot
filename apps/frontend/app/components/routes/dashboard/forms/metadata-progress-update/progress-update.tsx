import { Center, Loader, Stack, Text } from "@mantine/core";
import { useMetadataDetails, useUserMetadataDetails } from "~/lib/shared/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import { MetadataInProgressUpdateForm } from "./in-progress-form";
import { MetadataNewProgressUpdateForm } from "./new-progress-form";

export const MetadataProgressUpdateForm = (props: {
	closeMetadataProgressUpdateModal: () => void;
}) => {
	const { metadataToUpdate } = useMetadataProgressUpdate();

	const [{ data: metadataDetails }] = useMetadataDetails(
		metadataToUpdate?.metadataId,
	);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		metadataToUpdate?.metadataId,
	);

	if (!metadataDetails || !metadataToUpdate || !userMetadataDetails)
		return (
			<Center p="lg">
				<Loader type="dots" />
			</Center>
		);

	const onSubmit = () => {
		props.closeMetadataProgressUpdateModal();
	};

	return (
		<Stack>
			<Text fw="bold" ta="center" truncate>
				{metadataDetails.title}
			</Text>
			{userMetadataDetails.inProgress ? (
				<MetadataInProgressUpdateForm
					onSubmit={onSubmit}
					metadataId={metadataDetails.id}
					inProgress={userMetadataDetails.inProgress}
				/>
			) : (
				<MetadataNewProgressUpdateForm
					onSubmit={onSubmit}
					metadataId={metadataDetails.id}
					history={userMetadataDetails.history}
				/>
			)}
		</Stack>
	);
};
