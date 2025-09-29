import {
	ActionIcon,
	Anchor,
	Avatar,
	Box,
	Button,
	FileButton,
	Group,
	Modal,
	NumberInput,
	Stack,
	Text,
	TextInput,
	Textarea,
} from "@mantine/core";
import { useDebouncedState, useDidUpdate } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { GetPresignedS3UrlDocument } from "@ryot/generated/graphql/backend/graphql";
import { isNumber, isString } from "@ryot/ts-utils";
import {
	IconCamera,
	IconLibraryPhoto,
	IconTrash,
	IconVideo,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import { useState } from "react";
import invariant from "tiny-invariant";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import {
	useCoreDetails,
	useDeleteS3AssetMutation,
	useExerciseDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import {
	clientSideFileUpload,
	openConfirmationModal,
} from "~/lib/shared/ui-utils";
import { useCurrentWorkout } from "~/lib/state/fitness";
import { useFullscreenImage } from "~/lib/state/general";

export const NameAndOtherInputs = (props: {
	isCreatingTemplate: boolean;
	openAssetsModal: () => void;
}) => {
	const userPreferences = useUserPreferences();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	invariant(currentWorkout);

	const [name, setName] = useDebouncedState(currentWorkout.name, 500);
	const [comment, setComment] = useDebouncedState(currentWorkout.comment, 500);
	const [isCaloriesBurntModalOpen, setIsCaloriesBurntModalOpen] =
		useState(false);
	const [caloriesBurnt, setCaloriesBurnt] = useDebouncedState(
		currentWorkout.caloriesBurnt,
		500,
	);
	const workoutHasImages = currentWorkout.images.length > 0;

	useDidUpdate(() => {
		if (name)
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					draft.name = name;
				}),
			);
	}, [name]);

	useDidUpdate(() => {
		setCurrentWorkout(
			produce(currentWorkout, (draft) => {
				draft.comment = comment || undefined;
			}),
		);
	}, [comment]);

	useDidUpdate(() => {
		setCurrentWorkout(
			produce(currentWorkout, (draft) => {
				draft.caloriesBurnt = caloriesBurnt;
			}),
		);
	}, [caloriesBurnt]);

	return (
		<>
			<Modal
				title="Additional details"
				opened={isCaloriesBurntModalOpen}
				onClose={() => setIsCaloriesBurntModalOpen(false)}
			>
				<Stack gap="xs">
					<NumberInput
						size="sm"
						value={currentWorkout.caloriesBurnt}
						label={`Energy burnt in ${userPreferences.fitness.logging.caloriesBurntUnit}`}
						onChange={(e) => setCaloriesBurnt(isNumber(e) ? e : undefined)}
					/>
					<Textarea
						size="sm"
						minRows={2}
						label="Comments"
						defaultValue={comment}
						placeholder="Your thoughts about this workout"
						onChange={(e) => setComment(e.currentTarget.value)}
					/>
				</Stack>
			</Modal>
			<TextInput
				size="sm"
				defaultValue={name}
				placeholder="A name for your workout"
				styles={{ label: { width: "100%" } }}
				onChange={(e) => setName(e.currentTarget.value)}
				rightSection={
					<ActionIcon
						onClick={props.openAssetsModal}
						variant={workoutHasImages ? "outline" : undefined}
					>
						<IconCamera size={30} />
					</ActionIcon>
				}
				label={
					<Group justify="space-between" mr="xs">
						<Text size="sm">Name</Text>
						{!props.isCreatingTemplate ? (
							<Anchor
								size="xs"
								onClick={() => setIsCaloriesBurntModalOpen(true)}
							>
								More Information
							</Anchor>
						) : null}
					</Group>
				}
			/>
		</>
	);
};

const AssetDisplay = (props: {
	s3Key: string;
	type: "video" | "image";
	removeAsset: () => void;
}) => {
	const { setFullscreenImage } = useFullscreenImage();
	const srcUrlQuery = useQuery({
		queryKey: queryFactory.miscellaneous.presignedS3Url(props.s3Key).queryKey,
		queryFn: () =>
			clientGqlService
				.request(GetPresignedS3UrlDocument, { key: props.s3Key })
				.then((v) => v.getPresignedS3Url),
	});

	return (
		<Box pos="relative">
			{props.type === "video" ? (
				<Avatar
					size="lg"
					name="Video"
					style={{ cursor: "pointer" }}
					onClick={() => setFullscreenImage({ src: srcUrlQuery.data ?? "" })}
				/>
			) : (
				<Avatar
					size="lg"
					src={srcUrlQuery.data}
					style={{ cursor: "pointer" }}
					onClick={() => setFullscreenImage({ src: srcUrlQuery.data ?? "" })}
				/>
			)}
			<ActionIcon
				top={0}
				size="xs"
				left={-12}
				color="red"
				pos="absolute"
				onClick={() => {
					openConfirmationModal(
						`Are you sure you want to remove this ${props.type}?`,
						() => props.removeAsset(),
					);
				}}
			>
				<IconTrash />
			</ActionIcon>
		</Box>
	);
};

export const UploadAssetsModal = (props: {
	closeModal: () => void;
	modalOpenedBy: string | null | undefined;
}) => {
	const coreDetails = useCoreDetails();
	const fileUploadAllowed = coreDetails.fileStorageEnabled;
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [isFileUploading, setIsFileUploading] = useState(false);
	const deleteS3AssetMutation = useDeleteS3AssetMutation();

	if (!currentWorkout) return null;

	const exerciseIdx = currentWorkout.exercises.findIndex(
		(e) => e.identifier === props.modalOpenedBy,
	);
	const exercise =
		exerciseIdx !== -1 ? currentWorkout.exercises[exerciseIdx] : null;

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

	const { data: exerciseDetails } = useExerciseDetails(
		exercise?.exerciseId || "",
		!!exercise?.exerciseId,
	);

	const imagesToDisplay = isString(props.modalOpenedBy)
		? exercise?.images || []
		: currentWorkout.images;

	const videosToDisplay = isString(props.modalOpenedBy)
		? exercise?.videos || []
		: currentWorkout.videos;

	const hasAssets = imagesToDisplay.length > 0 || videosToDisplay.length > 0;

	const onRemoveAsset = (key: string, type: "image" | "video") => {
		deleteS3AssetMutation.mutate(key);
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
