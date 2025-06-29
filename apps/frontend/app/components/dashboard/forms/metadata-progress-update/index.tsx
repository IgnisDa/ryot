import { Center, Loader } from "@mantine/core";
import { useMetadataDetails, useUserMetadataDetails } from "~/lib/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import { MetadataInProgressUpdateForm } from "./in-progress-form";
import { MetadataNewProgressUpdateForm } from "./new-progress-form";

export const MetadataProgressUpdateForm = ({
	closeMetadataProgressUpdateModal,
}: {
	closeMetadataProgressUpdateModal: () => void;
}) => {
	const [metadataToUpdate] = useMetadataProgressUpdate();

	const { data: metadataDetails } = useMetadataDetails(
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
		closeMetadataProgressUpdateModal();
	};

	return userMetadataDetails.inProgress ? (
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
	);
};
