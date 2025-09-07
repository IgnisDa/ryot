import {
	Center,
	Divider,
	Loader,
	SegmentedControl,
	Stack,
	Text,
} from "@mantine/core";
import { EntityLot } from "@ryot/generated/graphql/backend/graphql";
import { useMetadataDetails, useUserMetadataDetails } from "~/lib/shared/hooks";
import {
	useAddEntityToCollections,
	useMetadataProgressUpdate,
} from "~/lib/state/media";
import { MetadataInProgressUpdateForm } from "./in-progress-form";
import { MetadataNewProgressUpdateForm } from "./new-progress-form";

enum Target {
	Progress = "progress",
	Collection = "collection",
}

export const MetadataProgressUpdateForm = ({
	closeMetadataProgressUpdateModal,
}: {
	closeMetadataProgressUpdateModal: () => void;
}) => {
	const { metadataToUpdate } = useMetadataProgressUpdate();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();

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

	return (
		<Stack gap="lg">
			<Text fw="bold" ta="center" truncate>
				{metadataDetails.title}
			</Text>
			<SegmentedControl
				fullWidth
				defaultValue={Target.Progress}
				data={[
					{ label: "Update Progress", value: Target.Progress },
					{ label: "Add to Collection", value: Target.Collection },
				]}
				onChange={(value) => {
					if (value === Target.Collection) {
						setAddEntityToCollectionsData({
							entityLot: EntityLot.Metadata,
							entityId: metadataToUpdate.metadataId,
						});
						closeMetadataProgressUpdateModal();
					}
				}}
			/>
			<Divider />
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
