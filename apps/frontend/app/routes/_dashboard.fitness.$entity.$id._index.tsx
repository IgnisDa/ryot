import {
	ActionIcon,
	Anchor,
	Avatar,
	Box,
	Button,
	Collapse,
	Container,
	Group,
	Menu,
	Modal,
	SimpleGrid,
	Stack,
	Text,
	Title,
	Tooltip,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	DeleteUserWorkoutDocument,
	DeleteUserWorkoutTemplateDocument,
	EntityLot,
	UpdateUserWorkoutAttributesDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	getActionIntent,
	humanizeDuration,
	parseParameters,
	processSubmission,
} from "@ryot/ts-utils";
import {
	IconArchive,
	IconBarbell,
	IconClock,
	IconClockEdit,
	IconDotsVertical,
	IconFlame,
	IconPencil,
	IconPlayerPlay,
	IconRepeat,
	IconRoad,
	IconTemplate,
	IconTrash,
	IconTrophy,
	IconWeight,
	IconZzz,
} from "@tabler/icons-react";
import { type ReactNode, useMemo, useState } from "react";
import { Form, Link, data, useLoaderData } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import {
	DisplayCollectionToEntity,
	ProRequiredAlert,
	SkeletonLoader,
} from "~/components/common";
import { ExerciseHistory } from "~/components/fitness/components";
import { WorkoutRevisionScheduledAlert } from "~/components/fitness/display-items";
import {
	displayDistanceWithUnit,
	displayWeightWithUnit,
} from "~/components/fitness/utils";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useConfirmSubmit,
	useCoreDetails,
	useGetWorkoutStarter,
	useInvalidateUserDetails,
	useMetadataDetails,
	useS3PresignedUrls,
	useUserPreferences,
	useUserUnitSystem,
	useUserWorkoutDetails,
	useUserWorkoutTemplateDetails,
} from "~/lib/shared/hooks";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import { duplicateOldWorkout } from "~/lib/state/fitness";
import { useFullscreenImage } from "~/lib/state/general";
import { useAddEntityToCollections } from "~/lib/state/media";
import { FitnessAction, FitnessEntity } from "~/lib/types";
import {
	createToastHeaders,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.fitness.$entity.$id._index";

export const loader = async ({ params }: Route.LoaderArgs) => {
	const { id: entityId, entity } = parseParameters(
		params,
		z.object({ id: z.string(), entity: z.enum(FitnessEntity) }),
	);
	return { entityId, entity };
};

export const meta = () => {
	return [{ title: "Fitness Entity | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("edit", async () => {
			const submission = processSubmission(formData, editWorkoutSchema);
			submission.startTime = dayjsLib(submission.startTime).toISOString();
			submission.endTime = dayjsLib(submission.endTime).toISOString();
			await serverGqlService.authenticatedRequest(
				request,
				UpdateUserWorkoutAttributesDocument,
				{ input: submission },
			);
			return data({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Workout edited successfully",
				}),
			});
		})
		.with("delete", async () => {
			const submission = processSubmission(formData, deleteSchema);
			if (submission.workoutId)
				await serverGqlService.authenticatedRequest(
					request,
					DeleteUserWorkoutDocument,
					{ workoutId: submission.workoutId },
				);
			else if (submission.templateId)
				await serverGqlService.authenticatedRequest(
					request,
					DeleteUserWorkoutTemplateDocument,
					{ workoutTemplateId: submission.templateId },
				);
			const { entity } = submission;
			return redirectWithToast($path("/fitness/:entity/list", { entity }), {
				type: "success",
				message: `${changeCase(entity)} deleted successfully`,
			});
		})
		.run();
};

const deleteSchema = z.object({
	workoutId: z.string().optional(),
	templateId: z.string().optional(),
	entity: z.enum(FitnessEntity),
});

const editWorkoutSchema = z.object({
	id: z.string(),
	endTime: z.string(),
	startTime: z.string(),
});

const WorkoutAssetsList = (props: { images: string[]; videos: string[] }) => {
	const { setFullscreenImage } = useFullscreenImage();

	return (
		<Avatar.Group>
			{props.images.map((src) => (
				<Avatar
					key={src}
					src={src}
					style={{ cursor: "pointer" }}
					onClick={() => setFullscreenImage({ src })}
				/>
			))}
			{props.videos.map((src) => (
				<Avatar
					key={src}
					name="Video"
					style={{ cursor: "pointer" }}
					onClick={() => setFullscreenImage({ src })}
				/>
			))}
		</Avatar.Group>
	);
};

export default function Page() {
	const submit = useConfirmSubmit();
	const coreDetails = useCoreDetails();
	const unitSystem = useUserUnitSystem();
	const userPreferences = useUserPreferences();
	const invalidateUserDetails = useInvalidateUserDetails();
	const { entityId, entity } = useLoaderData<typeof loader>();
	const [
		adjustTimeModalOpened,
		{ open: adjustTimeModalOpen, close: adjustTimeModalClose },
	] = useDisclosure(false);
	const [metadataConsumedOpened, setMetadataConsumedOpened] = useLocalStorage(
		`MetadataConsumedOpened-${entityId}`,
		false,
	);
	const [isWorkoutLoading, setIsWorkoutLoading] = useState(false);
	const startWorkout = useGetWorkoutStarter();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();

	const { data: workoutData } = useUserWorkoutDetails(
		entityId,
		entity === FitnessEntity.Workouts,
	);

	const { data: templateData } = useUserWorkoutTemplateDetails(
		entityId,
		entity === FitnessEntity.Templates,
	);

	const { data: repeatedWorkoutData } = useUserWorkoutDetails(
		workoutData?.details.repeatedFrom,
		!!(workoutData?.details.repeatedFrom && entity === FitnessEntity.Workouts),
	);

	const { data: templateDetailsData } = useUserWorkoutTemplateDetails(
		workoutData?.details.templateId || "",
		!!(workoutData?.details.templateId && entity === FitnessEntity.Workouts),
	);

	const currentData =
		entity === FitnessEntity.Workouts ? workoutData : templateData;
	const s3ImagesPresigned = useS3PresignedUrls(
		currentData?.details.information.assets?.s3Images,
	);
	const s3VideosPresigned = useS3PresignedUrls(
		currentData?.details.information.assets?.s3Videos,
	);

	const loaderData = useMemo(() => {
		const baseData = match(entity)
			.with(FitnessEntity.Workouts, () => {
				if (!workoutData) return null;

				const repeatedWorkout =
					repeatedWorkoutData && workoutData.details.repeatedFrom
						? {
								id: workoutData.details.repeatedFrom,
								name: repeatedWorkoutData.details.name,
								doneOn: repeatedWorkoutData.details.startTime,
							}
						: null;

				const template =
					templateDetailsData && workoutData.details.templateId
						? {
								id: workoutData.details.templateId,
								name: templateDetailsData.details.name,
							}
						: null;

				return {
					entity,
					template,
					entityId,
					repeatedWorkout,
					collections: workoutData.collections,
					endTime: workoutData.details.endTime,
					summary: workoutData.details.summary,
					entityName: workoutData.details.name,
					duration: workoutData.details.duration,
					startTime: workoutData.details.startTime,
					information: workoutData.details.information,
					metadataConsumed: workoutData.metadataConsumed,
					caloriesBurnt: workoutData.details.caloriesBurnt,
				};
			})
			.with(FitnessEntity.Templates, () => {
				if (!templateData) return null;

				return {
					entity,
					entityId,
					endTime: null,
					template: null,
					caloriesBurnt: null,
					metadataConsumed: [],
					repeatedWorkout: null,
					collections: templateData.collections,
					summary: templateData.details.summary,
					entityName: templateData.details.name,
					startTime: templateData.details.createdOn,
					information: templateData.details.information,
				};
			})
			.exhaustive();

		if (!baseData) return null;

		const remoteImages = baseData.information.assets?.remoteImages || [];
		const remoteVideoUrls =
			baseData.information.assets?.remoteVideos.map((v) => v.url) || [];
		const images = [...remoteImages, ...(s3ImagesPresigned.data || [])];
		const videos = [...remoteVideoUrls, ...(s3VideosPresigned.data || [])];
		const hasAssets = images.length > 0 || videos.length > 0;

		return { ...baseData, images, videos, hasAssets };
	}, [
		entity,
		entityId,
		workoutData,
		templateData,
		repeatedWorkoutData,
		templateDetailsData,
		s3ImagesPresigned.data,
		s3VideosPresigned.data,
	]);

	if (!loaderData)
		return (
			<Container>
				<SkeletonLoader />
			</Container>
		);

	const entityLot = match(loaderData.entity)
		.with(FitnessEntity.Workouts, () => EntityLot.Workout)
		.with(FitnessEntity.Templates, () => EntityLot.WorkoutTemplate)
		.exhaustive();

	const performDecision = async (params: {
		templateId?: string;
		action: FitnessAction;
		repeatedFromId?: string;
		updateWorkoutId?: string;
		updateWorkoutTemplateId?: string;
	}) => {
		setIsWorkoutLoading(true);
		const workout = await duplicateOldWorkout(
			loaderData.entityName,
			params.action,
			loaderData.caloriesBurnt ? Number(loaderData.caloriesBurnt) : undefined,
			loaderData.information,
			params,
		);
		startWorkout(workout, params.action);
		setIsWorkoutLoading(false);
	};

	return (
		<Container size="xs">
			{loaderData.startTime && loaderData.endTime ? (
				<Modal
					centered
					withCloseButton={false}
					opened={adjustTimeModalOpened}
					onClose={adjustTimeModalClose}
				>
					<Form
						replace
						method="POST"
						action={withQuery(".", { intent: "edit" })}
						onSubmit={() => {
							adjustTimeModalClose();
							invalidateUserDetails();
						}}
					>
						<Stack>
							<Title order={3}>Adjust times</Title>
							<DateTimePicker
								required
								name="startTime"
								label="Start time"
								defaultValue={new Date(loaderData.startTime)}
							/>
							<DateTimePicker
								required
								name="endTime"
								label="End time"
								defaultValue={new Date(loaderData.endTime)}
							/>
							<Button
								name="id"
								type="submit"
								variant="outline"
								value={loaderData.entityId}
							>
								Submit
							</Button>
						</Stack>
					</Form>
				</Modal>
			) : null}
			<Stack>
				<WorkoutRevisionScheduledAlert />
				<Group justify="space-between" wrap="nowrap">
					<Title>{loaderData.entityName}</Title>
					<Menu shadow="md" position="bottom-end">
						<Menu.Target>
							<ActionIcon variant="transparent" loading={isWorkoutLoading}>
								<IconDotsVertical />
							</ActionIcon>
						</Menu.Target>
						<Menu.Dropdown>
							{match(loaderData.entity)
								.with(FitnessEntity.Templates, () => (
									<>
										<Menu.Item
											onClick={() =>
												performDecision({
													action: FitnessAction.LogWorkout,
													templateId: loaderData.entityId,
												})
											}
											leftSection={<IconPlayerPlay size={14} />}
										>
											Start workout
										</Menu.Item>
										<Menu.Item
											onClick={() =>
												performDecision({
													action: FitnessAction.CreateTemplate,
													updateWorkoutTemplateId: loaderData.entityId,
												})
											}
											leftSection={<IconPencil size={14} />}
										>
											Edit template
										</Menu.Item>
									</>
								))
								.with(FitnessEntity.Workouts, () => (
									<>
										<Menu.Item
											onClick={() =>
												performDecision({
													repeatedFromId: entityId,
													action: FitnessAction.LogWorkout,
												})
											}
											leftSection={<IconRepeat size={14} />}
										>
											Duplicate
										</Menu.Item>
										<Menu.Item
											onClick={() =>
												performDecision({
													updateWorkoutId: entityId,
													action: FitnessAction.UpdateWorkout,
												})
											}
											leftSection={<IconPencil size={14} />}
										>
											Edit workout
										</Menu.Item>
										<Menu.Item
											onClick={adjustTimeModalOpen}
											leftSection={<IconClockEdit size={14} />}
										>
											Adjust time
										</Menu.Item>
										<Menu.Item
											onClick={() => {
												if (!coreDetails.isServerKeyValidated) {
													notifications.show({
														color: "red",
														message: PRO_REQUIRED_MESSAGE,
													});
													return;
												}
												performDecision({
													action: FitnessAction.CreateTemplate,
												});
											}}
											leftSection={<IconTemplate size={14} />}
										>
											Create template
										</Menu.Item>
									</>
								))
								.exhaustive()}
							<Menu.Item
								leftSection={<IconArchive size={14} />}
								onClick={() =>
									setAddEntityToCollectionsData({ entityId, entityLot })
								}
							>
								Add to collection
							</Menu.Item>
							<Form method="POST" action={withQuery(".", { intent: "delete" })}>
								<input
									type="hidden"
									value={entityId}
									name={match(entity)
										.with(FitnessEntity.Workouts, () => "workoutId")
										.with(FitnessEntity.Templates, () => "templateId")
										.exhaustive()}
								/>
								<input type="hidden" name="entity" value={entity} />
								<Menu.Item
									onClick={(e) => {
										const form = e.currentTarget.form;
										e.preventDefault();
										openConfirmationModal(
											`Are you sure you want to delete this ${entity}? This action is not reversible.`,
											() => submit(form),
										);
									}}
									color="red"
									leftSection={<IconTrash size={14} />}
									type="submit"
								>
									Delete
								</Menu.Item>
							</Form>
						</Menu.Dropdown>
					</Menu>
				</Group>
				{loaderData.collections.length > 0 ? (
					<Group>
						{loaderData.collections.map((col) => (
							<DisplayCollectionToEntity
								col={col}
								key={col.id}
								entityId={entityId}
								entityLot={entityLot}
							/>
						))}
					</Group>
				) : null}
				{loaderData.repeatedWorkout ? (
					<Box>
						<Text c="dimmed" span size="sm">
							Repeated from{" "}
						</Text>
						<Anchor
							size="sm"
							component={Link}
							to={$path("/fitness/:entity/:id", {
								entity: "workouts",
								id: loaderData.repeatedWorkout.id,
							})}
						>
							{loaderData.repeatedWorkout.name}
						</Anchor>
						<Text c="dimmed" span size="sm">
							{" "}
							on{" "}
							{dayjsLib(loaderData.repeatedWorkout.doneOn).format("dddd, LLL")}
						</Text>
					</Box>
				) : null}
				{loaderData.template ? (
					<Box>
						<Text c="dimmed" span size="sm">
							Template used:
						</Text>{" "}
						<Anchor
							size="sm"
							component={Link}
							to={$path("/fitness/:entity/:id", {
								entity: "templates",
								id: loaderData.template.id,
							})}
						>
							{loaderData.template.name}
						</Anchor>
					</Box>
				) : null}
				<Box>
					<Text c="dimmed" span>
						{loaderData.entity === FitnessEntity.Templates
							? "Created on"
							: "Done on"}{" "}
					</Text>
					<Text span>{dayjsLib(loaderData.startTime).format("dddd, LLL")}</Text>
					<SimpleGrid mt="xs" cols={{ base: 3, md: 4, xl: 5 }}>
						{loaderData.endTime && loaderData.startTime ? (
							<DisplayStat
								icon={<IconClock size={16} />}
								data={humanizeDuration(
									dayjsLib
										.duration(loaderData.duration, "second")
										.asMilliseconds(),
									{
										round: true,
										units: ["h", "m"],
									},
								)}
							/>
						) : null}
						{loaderData.summary.total ? (
							<>
								{Number(loaderData.summary.total.weight) !== 0 ? (
									<DisplayStat
										icon={<IconWeight size={16} />}
										data={displayWeightWithUnit(
											unitSystem,
											loaderData.summary.total.weight,
										)}
									/>
								) : null}
								{Number(loaderData.summary.total.distance) > 0 ? (
									<DisplayStat
										icon={<IconRoad size={16} />}
										data={displayDistanceWithUnit(
											unitSystem,
											loaderData.summary.total.distance,
										)}
									/>
								) : null}
								<DisplayStat
									icon={<IconBarbell size={16} />}
									data={`${loaderData.summary.exercises.length} Exercises`}
								/>
								{Number(loaderData.summary.total.personalBestsAchieved) !==
								0 ? (
									<DisplayStat
										icon={<IconTrophy size={16} />}
										data={`${loaderData.summary.total.personalBestsAchieved} PRs`}
									/>
								) : null}
								{loaderData.summary.total.restTime > 0 ? (
									<DisplayStat
										icon={<IconZzz size={16} />}
										data={humanizeDuration(
											loaderData.summary.total.restTime * 1e3,
											{ round: true, units: ["m", "s"] },
										)}
									/>
								) : null}
								{loaderData.caloriesBurnt &&
								Number(loaderData.caloriesBurnt) > 0 ? (
									<DisplayStat
										icon={<IconFlame size={16} />}
										data={`${loaderData.caloriesBurnt} ${userPreferences.fitness.logging.caloriesBurntUnit}`}
									/>
								) : null}
							</>
						) : null}
					</SimpleGrid>
				</Box>
				{loaderData.metadataConsumed.length > 0 ? (
					<Stack gap="xs">
						<Anchor
							size="xs"
							onClick={() => setMetadataConsumedOpened(!metadataConsumedOpened)}
						>
							Consumed {loaderData.metadataConsumed.length} items during this
							workout [{metadataConsumedOpened ? "collapse" : "expand"}]
						</Anchor>
						<Collapse in={metadataConsumedOpened}>
							{coreDetails.isServerKeyValidated ? (
								<SimpleGrid
									verticalSpacing="xs"
									cols={{ base: 7, sm: 8, md: 10 }}
								>
									{metadataConsumedOpened &&
										loaderData.metadataConsumed.map((m) => (
											<ConsumedMetadataDisplay
												key={m}
												metadataId={m}
												enabled={metadataConsumedOpened}
											/>
										))}
								</SimpleGrid>
							) : (
								<ProRequiredAlert />
							)}
						</Collapse>
					</Stack>
				) : null}
				{loaderData.information.comment ? (
					<Box>
						<Text c="dimmed" span>
							Commented:{" "}
						</Text>
						<Text span>{loaderData.information.comment}</Text>
					</Box>
				) : null}
				{loaderData.hasAssets ? (
					<WorkoutAssetsList
						images={loaderData.images}
						videos={loaderData.videos}
					/>
				) : null}
				{loaderData.information.exercises.map((exercise, idx) => (
					<ExerciseHistory
						exerciseIdx={idx}
						entityId={entityId}
						fitnessEntityType={entity}
						key={`${exercise.id}-${idx}`}
						supersetInformation={loaderData.information.supersets}
					/>
				))}
			</Stack>
		</Container>
	);
}

const ConsumedMetadataDisplay = (props: {
	enabled: boolean;
	metadataId: string;
}) => {
	const [{ data: metadataDetails }, _, metadataTranslations] =
		useMetadataDetails(props.metadataId, props.enabled);
	const s3PresignedUrls = useS3PresignedUrls(metadataDetails?.assets.s3Images);
	const images = [
		...(metadataDetails?.assets.remoteImages || []),
		...(s3PresignedUrls.data || []),
	];

	return (
		<Link to={$path("/media/item/:id", { id: props.metadataId })}>
			<Tooltip label={metadataTranslations?.title || metadataDetails?.title}>
				<Avatar src={metadataTranslations?.image || images.at(0)} />
			</Tooltip>
		</Link>
	);
};

const DisplayStat = (props: { icon: ReactNode; data: string }) => {
	return (
		<Stack gap={4} align="center" justify="center">
			{props.icon}
			<Text span size="sm" ta="center">
				{props.data}
			</Text>
		</Stack>
	);
};
