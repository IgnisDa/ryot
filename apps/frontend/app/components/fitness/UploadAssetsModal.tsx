import {
	Avatar,
	Button,
	FileButton,
	Group,
	Modal,
	Stack,
	Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { isString } from "@ryot/ts-utils";
import { IconLibraryPhoto, IconVideo } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import { useState } from "react";
import { PRO_REQUIRED_MESSAGE, clientSideFileUpload } from "~/lib/common";
import { useCoreDetails } from "~/lib/hooks";
import {
	getExerciseDetailsQuery,
	useCurrentWorkout,
} from "~/lib/state/fitness";
import { AssetDisplay } from "./AssetDisplay";

const deleteUploadedAsset = (key: string) => {
	fetch(`/api/upload/${key}`, { method: "DELETE" }).catch(() => {});
};

export const UploadAssetsModal = (props: {
	closeModal: () => void;
	modalOpenedBy: string | null | undefined;
}) => {
	const coreDetails = useCoreDetails();
	const fileUploadAllowed = coreDetails.fileStorageEnabled;
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [isFileUploading, setIsFileUploading] = useState(false);

	if (!currentWorkout) return null;

	const afterFileSelected = async (
		file: File | null,
		type: "image" | "video",
	) => {
		if (props.modalOpenedBy === null && !coreDetails.isServerKeyValidated) {
			notifications.show({
				color: "red",
				message: PRO_REQUIRED_MESSAGE,
			});
			return;
		}
		if (!file) return;
		setIsFileUploading(true);
		try {
			const key = await clientSideFileUpload(file, "workouts");
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					if (type === "image") {
						if (exercise) draft.exercises[exerciseIdx].images.push(key);
						else draft.images.push(key);
					} else {
						if (exercise) draft.exercises[exerciseIdx].videos.push(key);
						else draft.videos.push(key);
					}
				}),
			);
		} catch {
			notifications.show({
				color: "red",
				message: `Error while uploading ${type}`,
			});
		} finally {
			setIsFileUploading(false);
		}
	};

	const exerciseIdx = currentWorkout.exercises.findIndex(
		(e) => e.identifier === props.modalOpenedBy,
	);
	const exercise =
		exerciseIdx !== -1 ? currentWorkout.exercises[exerciseIdx] : null;

	const { data: exerciseDetails } = useQuery({
		...getExerciseDetailsQuery(exercise?.exerciseId || ""),
		enabled: exercise !== null,
	});

	const imagesToDisplay = isString(props.modalOpenedBy)
		? exercise?.images || []
		: currentWorkout.images;

	const videosToDisplay = isString(props.modalOpenedBy)
		? exercise?.videos || []
		: currentWorkout.videos;

	const hasAssets = imagesToDisplay.length > 0 || videosToDisplay.length > 0;

	const onRemoveAsset = (key: string, type: "image" | "video") => {
		deleteUploadedAsset(key);
		setCurrentWorkout(
			produce(currentWorkout, (draft) => {
				if (type === "image") {
					if (exerciseIdx !== -1) {
						draft.exercises[exerciseIdx].images = draft.exercises[
							exerciseIdx
						].images.filter((i) => i !== key);
					} else {
						draft.images = draft.images.filter((i) => i !== key);
					}
					return;
				}
				if (exerciseIdx !== -1) {
					draft.exercises[exerciseIdx].videos = draft.exercises[
						exerciseIdx
					].videos.filter((i) => i !== key);
				} else {
					draft.videos = draft.videos.filter((i) => i !== key);
				}
			}),
		);
	};

	return (
		<Modal
			onClose={() => props.closeModal()}
			opened={props.modalOpenedBy !== undefined}
			title={`Images for ${exerciseDetails ? exerciseDetails.name : "the workout"}`}
		>
			<Stack>
				{fileUploadAllowed ? (
					<>
						{hasAssets ? (
							<Avatar.Group spacing="xs">
								{imagesToDisplay.map((i) => (
									<AssetDisplay
										key={i}
										s3Key={i}
										type="image"
										removeAsset={() => onRemoveAsset(i, "image")}
									/>
								))}
								{videosToDisplay.map((i) => (
									<AssetDisplay
										key={i}
										s3Key={i}
										type="video"
										removeAsset={() => onRemoveAsset(i, "video")}
									/>
								))}
							</Avatar.Group>
						) : null}
						<Group justify="space-between">
							<FileButton
								accept="image/*"
								onChange={(file) => afterFileSelected(file, "image")}
							>
								{(props) => (
									<Button
										{...props}
										flex={1}
										color="cyan"
										variant="outline"
										loading={isFileUploading}
										leftSection={<IconLibraryPhoto />}
									>
										Image
									</Button>
								)}
							</FileButton>
							<FileButton
								accept="video/*"
								onChange={(file) => afterFileSelected(file, "video")}
							>
								{(props) => (
									<Button
										{...props}
										flex={1}
										color="cyan"
										variant="outline"
										loading={isFileUploading}
										leftSection={<IconVideo />}
									>
										Video
									</Button>
								)}
							</FileButton>
						</Group>
					</>
				) : (
					<Text c="red" size="sm">
						Please set the S3 variables required to enable file uploading
					</Text>
				)}
			</Stack>
		</Modal>
	);
};
