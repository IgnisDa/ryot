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
import { useDisclosure, useInViewport } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	DeleteUserWorkoutDocument,
	DeleteUserWorkoutTemplateDocument,
	EntityLot,
	UpdateUserWorkoutAttributesDocument,
	UserWorkoutDetailsDocument,
	UserWorkoutTemplateDetailsDocument,
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
import { type ReactNode, useState } from "react";
import { Form, Link, data, useLoaderData } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import {
	DisplayCollectionToEntity,
	ProRequiredAlert,
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
	useMetadataDetails,
	useUserPreferences,
	useUserUnitSystem,
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

export const loader = async ({ request, params }: Route.LoaderArgs) => {
	const { id: entityId, entity } = parseParameters(
		params,
		z.object({ id: z.string(), entity: z.enum(FitnessEntity) }),
	);
	const resp = await match(entity)
		.with(FitnessEntity.Workouts, async () => {
			const [{ userWorkoutDetails }] = await Promise.all([
				serverGqlService.authenticatedRequest(
					request,
					UserWorkoutDetailsDocument,
					{ workoutId: entityId },
				),
			]);
			let repeatedWorkout = null;
			if (userWorkoutDetails.details.repeatedFrom) {
				const { userWorkoutDetails: repeatedWorkoutData } =
					await serverGqlService.authenticatedRequest(
						request,
						UserWorkoutDetailsDocument,
						{ workoutId: userWorkoutDetails.details.repeatedFrom },
					);
				repeatedWorkout = {
					id: userWorkoutDetails.details.repeatedFrom,
					name: repeatedWorkoutData.details.name,
					doneOn: repeatedWorkoutData.details.startTime,
				};
			}
			let template = null;
			if (userWorkoutDetails.details.templateId) {
				const { userWorkoutTemplateDetails } =
					await serverGqlService.authenticatedRequest(
						request,
						UserWorkoutTemplateDetailsDocument,
						{ workoutTemplateId: userWorkoutDetails.details.templateId },
					);
				template = {
					id: userWorkoutDetails.details.templateId,
					name: userWorkoutTemplateDetails.details.name,
				};
			}
			return {
				template,
				repeatedWorkout: repeatedWorkout,
				collections: userWorkoutDetails.collections,
				endTime: userWorkoutDetails.details.endTime,
				summary: userWorkoutDetails.details.summary,
				entityName: userWorkoutDetails.details.name,
				duration: userWorkoutDetails.details.duration,
				startTime: userWorkoutDetails.details.startTime,
				information: userWorkoutDetails.details.information,
				metadataConsumed: userWorkoutDetails.metadataConsumed,
				caloriesBurnt: userWorkoutDetails.details.caloriesBurnt,
			};
		})
		.with(FitnessEntity.Templates, async () => {
			const [{ userWorkoutTemplateDetails }] = await Promise.all([
				serverGqlService.authenticatedRequest(
					request,
					UserWorkoutTemplateDetailsDocument,
					{ workoutTemplateId: entityId },
				),
			]);
			return {
				endTime: null,
				template: null,
				caloriesBurnt: null,
				metadataConsumed: [],
				repeatedWorkout: null,
				collections: userWorkoutTemplateDetails.collections,
				summary: userWorkoutTemplateDetails.details.summary,
				entityName: userWorkoutTemplateDetails.details.name,
				startTime: userWorkoutTemplateDetails.details.createdOn,
				information: userWorkoutTemplateDetails.details.information,
			};
		})
		.exhaustive();
	return { entityId, entity, ...resp };
};

export const meta = ({ data }: Route.MetaArgs) => {
	return [{ title: `${data?.entityName} | Ryot` }];
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
			{props.images.map((i) => (
				<Avatar
					key={i}
					src={i}
					style={{ cursor: "pointer" }}
					onClick={() => setFullscreenImage({ src: i })}
				/>
			))}
			{props.videos.map((v) => (
				<Avatar
					key={v}
					name="Video"
					style={{ cursor: "pointer" }}
					onClick={() => setFullscreenImage({ src: v })}
				/>
			))}
		</Avatar.Group>
	);
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const submit = useConfirmSubmit();
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const [
		adjustTimeModalOpened,
		{ open: adjustTimeModalOpen, close: adjustTimeModalClose },
	] = useDisclosure(false);
	const [metadataConsumedOpened, setMetadataConsumedOpened] = useLocalStorage(
		`MetadataConsumedOpened-${loaderData.entityId}`,
		false,
	);
	const [isWorkoutLoading, setIsWorkoutLoading] = useState(false);
	const startWorkout = useGetWorkoutStarter();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();
	const entityLot = match(loaderData.entity)
		.with(FitnessEntity.Workouts, () => EntityLot.Workout)
		.with(FitnessEntity.Templates, () => EntityLot.WorkoutTemplate)
		.exhaustive();
	const images = loaderData.information.assets?.s3Images || [];
	const videos = loaderData.information.assets?.s3Videos || [];
	const hasAssets = images.length > 0 || videos.length > 0;

	const performDecision = async (params: {
		action: FitnessAction;
		repeatedFromId?: string;
		templateId?: string;
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
		<>
			{loaderData.startTime && loaderData.endTime ? (
				<Modal
					opened={adjustTimeModalOpened}
					onClose={adjustTimeModalClose}
					withCloseButton={false}
					centered
				>
					<Form
						replace
						method="POST"
						onSubmit={() => adjustTimeModalClose()}
						action={withQuery(".", { intent: "edit" })}
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
			<Container size="xs">
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
														action: FitnessAction.LogWorkout,
														repeatedFromId: loaderData.entityId,
													})
												}
												leftSection={<IconRepeat size={14} />}
											>
												Duplicate
											</Menu.Item>
											<Menu.Item
												onClick={() =>
													performDecision({
														action: FitnessAction.UpdateWorkout,
														updateWorkoutId: loaderData.entityId,
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
										setAddEntityToCollectionsData({
											entityLot,
											entityId: loaderData.entityId,
										})
									}
								>
									Add to collection
								</Menu.Item>
								<Form
									method="POST"
									action={withQuery(".", { intent: "delete" })}
								>
									<input
										type="hidden"
										name={match(loaderData.entity)
											.with(FitnessEntity.Workouts, () => "workoutId")
											.with(FitnessEntity.Templates, () => "templateId")
											.exhaustive()}
										value={loaderData.entityId}
									/>
									<input
										type="hidden"
										name="entity"
										value={loaderData.entity}
									/>
									<Menu.Item
										onClick={(e) => {
											const form = e.currentTarget.form;
											e.preventDefault();
											openConfirmationModal(
												`Are you sure you want to delete this ${loaderData.entity}? This action is not reversible.`,
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
									entityLot={entityLot}
									entityId={loaderData.entityId}
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
								{dayjsLib(loaderData.repeatedWorkout.doneOn).format(
									"dddd, LLL",
								)}
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
							Done on{" "}
						</Text>
						<Text span>
							{dayjsLib(loaderData.startTime).format("dddd, LLL")}
						</Text>
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
								onClick={() =>
									setMetadataConsumedOpened(!metadataConsumedOpened)
								}
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
										{loaderData.metadataConsumed.map((m) => (
											<ConsumedMetadataDisplay key={m} metadataId={m} />
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
					{hasAssets ? (
						<WorkoutAssetsList images={images} videos={videos} />
					) : null}
					{loaderData.information.exercises.map((exercise, idx) => (
						<ExerciseHistory
							exerciseIdx={idx}
							key={`${exercise.id}-${idx}`}
							entityId={loaderData.entityId}
							entityType={loaderData.entity}
							supersetInformation={loaderData.information.supersets}
						/>
					))}
				</Stack>
			</Container>
		</>
	);
}

const ConsumedMetadataDisplay = (props: {
	metadataId: string;
}) => {
	const { ref, inViewport } = useInViewport();
	const { data: metadataDetails } = useMetadataDetails(
		props.metadataId,
		inViewport,
	);

	const images = [
		...(metadataDetails?.assets.remoteImages || []),
		...(metadataDetails?.assets.s3Images || []),
	];

	return (
		<Link to={$path("/media/item/:id", { id: props.metadataId })} ref={ref}>
			<Tooltip label={metadataDetails?.title}>
				<Avatar src={images.at(0)} />
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
