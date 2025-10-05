import { Button, Drawer, Modal, Stack, Text } from "@mantine/core";
import { FullscreenImageModal } from "~/components/common/layout";
import {
	useCreateOrUpdateCollectionModal,
	useEditEntityCollectionInformation,
} from "~/lib/state/collection";
import { useMeasurementsDrawer } from "~/lib/state/fitness";
import {
	useAddEntityToCollections,
	useMetadataProgressUpdate,
	useReviewEntity,
} from "~/lib/state/media";
import { useOnboardingTour } from "~/lib/state/onboarding-tour";
import { AddEntityToCollectionsForm } from "./forms/add-entity-to-collections-form";
import { CreateOrEditMeasurementForm } from "./forms/create-or-edit-measurement-form";
import { CreateOrUpdateCollectionModal } from "./forms/create-or-update-collection-form";
import { EditEntityCollectionInformationForm } from "./forms/edit-entity-collection-information-form";
import { MetadataProgressUpdateForm } from "./forms/metadata-progress-update/progress-update";
import { ReviewEntityForm } from "./forms/review-entity-form";

export function LayoutModals() {
	const { metadataToUpdate, initializeMetadataToUpdate } =
		useMetadataProgressUpdate();
	const closeMetadataProgressUpdateModal = () =>
		initializeMetadataToUpdate(null);
	const [entityToReview, setEntityToReview] = useReviewEntity();
	const closeReviewEntityModal = () => setEntityToReview(null);
	const [addEntityToCollectionsData, setAddEntityToCollectionsData] =
		useAddEntityToCollections();
	const closeAddEntityToCollectionsDrawer = () =>
		setAddEntityToCollectionsData(null);
	const [
		editEntityCollectionInformationData,
		setEditEntityCollectionInformationData,
	] = useEditEntityCollectionInformation();
	const closeEditEntityCollectionInformationModal = () =>
		setEditEntityCollectionInformationData(null);
	const [measurementsDrawerData, setMeasurementsDrawerData] =
		useMeasurementsDrawer();
	const closeMeasurementsDrawer = () => setMeasurementsDrawerData(false);
	const { completeOnboardingTour, isOnLastOnboardingTourStep } =
		useOnboardingTour();
	const { isOpen: isCollectionModalOpen, close: closeCollectionModal } =
		useCreateOrUpdateCollectionModal();

	return (
		<>
			<FullscreenImageModal />
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
				title="Add to collections"
				onClose={closeAddEntityToCollectionsDrawer}
				opened={addEntityToCollectionsData !== null}
			>
				<AddEntityToCollectionsForm
					closeAddEntityToCollectionsDrawer={closeAddEntityToCollectionsDrawer}
				/>
			</Drawer>
			<Drawer
				title={
					measurementsDrawerData && typeof measurementsDrawerData === "object"
						? "Edit measurement"
						: "Add new measurement"
				}
				opened={measurementsDrawerData !== false}
				onClose={closeMeasurementsDrawer}
			>
				<CreateOrEditMeasurementForm
					measurementToEdit={
						measurementsDrawerData && typeof measurementsDrawerData === "object"
							? measurementsDrawerData
							: null
					}
					closeMeasurementModal={closeMeasurementsDrawer}
				/>
			</Drawer>
			<Modal
				centered
				withCloseButton={false}
				onClose={closeEditEntityCollectionInformationModal}
				opened={editEntityCollectionInformationData !== null}
			>
				<EditEntityCollectionInformationForm
					closeEditEntityCollectionInformationModal={
						closeEditEntityCollectionInformationModal
					}
				/>
			</Modal>
			<Modal
				centered
				size="lg"
				withCloseButton={false}
				opened={isCollectionModalOpen}
				onClose={closeCollectionModal}
			>
				<CreateOrUpdateCollectionModal onClose={closeCollectionModal} />
			</Modal>
		</>
	);
}
