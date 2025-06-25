import { Button, Drawer, Modal, Stack, Text } from "@mantine/core";
import { AddEntityToCollectionsForm } from "~/components/dashboard/forms/add-entity-to-collections-form";
import { CreateMeasurementForm } from "~/components/dashboard/forms/create-measurement-form";
import { ReviewEntityForm } from "~/components/dashboard/forms/review-entity-form";
import { MetadataProgressUpdateForm } from "~/components/dashboard/modals/metadata-progress-update-forms";
import { useMeasurementsDrawerOpen } from "~/lib/state/fitness";
import {
	useAddEntityToCollections,
	useMetadataProgressUpdate,
	useReviewEntity,
} from "~/lib/state/media";

interface LayoutModalsProps {
	completeOnboardingTour: () => void;
	isOnLastOnboardingTourStep: boolean;
}

export function LayoutModals({
	completeOnboardingTour,
	isOnLastOnboardingTourStep,
}: LayoutModalsProps) {
	const [metadataToUpdate, setMetadataToUpdate] = useMetadataProgressUpdate();
	const closeMetadataProgressUpdateModal = () => setMetadataToUpdate(null);
	const [entityToReview, setEntityToReview] = useReviewEntity();
	const closeReviewEntityModal = () => setEntityToReview(null);
	const [addEntityToCollectionsData, setAddEntityToCollectionsData] =
		useAddEntityToCollections();
	const closeAddEntityToCollectionsDrawer = () =>
		setAddEntityToCollectionsData(null);
	const [measurementsDrawerOpen, setMeasurementsDrawerOpen] =
		useMeasurementsDrawerOpen();
	const closeMeasurementsDrawer = () => setMeasurementsDrawerOpen(false);

	return (
		<>
			<Modal
				centered
				withCloseButton={false}
				opened={metadataToUpdate !== null}
				onClose={closeMetadataProgressUpdateModal}
			>
				<MetadataProgressUpdateForm
					closeMetadataProgressUpdateModal={closeMetadataProgressUpdateModal}
				/>
			</Modal>
			<Modal
				centered
				withCloseButton={false}
				onClose={completeOnboardingTour}
				opened={isOnLastOnboardingTourStep}
				title="You've completed the onboarding tour!"
			>
				<Stack>
					<Text>
						These are just the basics to get you up and running. Ryot has a lot
						more to offer and I encourage you to explore the app and see what it
						can do for you.
					</Text>
					<Text size="sm" c="dimmed">
						You can restart the tour at any time from the profile settings.
					</Text>
					<Button variant="outline" onClick={completeOnboardingTour}>
						Start using Ryot!
					</Button>
				</Stack>
			</Modal>
			<Modal
				centered
				withCloseButton={false}
				opened={entityToReview !== null}
				onClose={() => setEntityToReview(null)}
				title={`Reviewing "${entityToReview?.entityTitle}"`}
			>
				<ReviewEntityForm closeReviewEntityModal={closeReviewEntityModal} />
			</Modal>
			<Drawer
				withCloseButton={false}
				onClose={closeAddEntityToCollectionsDrawer}
				opened={addEntityToCollectionsData !== null}
			>
				<AddEntityToCollectionsForm
					closeAddEntityToCollectionsDrawer={closeAddEntityToCollectionsDrawer}
				/>
			</Drawer>
			<Drawer
				title="Add new measurement"
				opened={measurementsDrawerOpen}
				onClose={closeMeasurementsDrawer}
			>
				<CreateMeasurementForm
					closeMeasurementModal={closeMeasurementsDrawer}
				/>
			</Drawer>
		</>
	);
}
