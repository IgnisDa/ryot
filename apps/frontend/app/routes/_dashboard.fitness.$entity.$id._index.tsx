import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Container,
	Group,
	Menu,
	Modal,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { $path } from "remix-routes";
import "@mantine/dates/styles.css";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
import { Form, Link, useLoaderData } from "@remix-run/react";
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
	humanizeDuration,
	processSubmission,
} from "@ryot/ts-utils";
import {
	IconArchive,
	IconBarbell,
	IconClock,
	IconClockEdit,
	IconDotsVertical,
	IconPencil,
	IconPlayerPlay,
	IconRepeat,
	IconRun,
	IconTemplate,
	IconTrash,
	IconTrophy,
	IconWeight,
	IconZzz,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { DisplayCollection } from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import {
	ExerciseHistory,
	displayDistanceWithUnit,
	displayWeightWithUnit,
} from "~/components/fitness";
import {
	FitnessAction,
	FitnessEntity,
	PRO_REQUIRED_MESSAGE,
	dayjsLib,
} from "~/lib/generals";
import {
	useConfirmSubmit,
	useCoreDetails,
	useGetWorkoutStarter,
	useUserUnitSystem,
} from "~/lib/hooks";
import { duplicateOldWorkout } from "~/lib/state/fitness";
import { useAddEntityToCollection } from "~/lib/state/media";
import {
	createToastHeaders,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const { id: entityId, entity } = zx.parseParams(params, {
		id: z.string(),
		entity: z.nativeEnum(FitnessEntity),
	});
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
				entityName: userWorkoutDetails.details.name,
				startTime: userWorkoutDetails.details.startTime,
				endTime: userWorkoutDetails.details.endTime,
				duration: userWorkoutDetails.details.duration,
				information: userWorkoutDetails.details.information,
				summary: userWorkoutDetails.details.summary,
				repeatedWorkout: repeatedWorkout,
				template,
				collections: userWorkoutDetails.collections,
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
				entityName: userWorkoutTemplateDetails.details.name,
				startTime: userWorkoutTemplateDetails.details.createdOn,
				endTime: null,
				information: userWorkoutTemplateDetails.details.information,
				summary: userWorkoutTemplateDetails.details.summary,
				repeatedWorkout: null,
				template: null,
				collections: userWorkoutTemplateDetails.collections,
			};
		})
		.exhaustive();
	return { entityId, entity, ...resp };
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${data?.entityName} | Ryot` }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		edit: async () => {
			const submission = processSubmission(formData, editWorkoutSchema);
			await serverGqlService.authenticatedRequest(
				request,
				UpdateUserWorkoutAttributesDocument,
				{ input: submission },
			);
			return Response.json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Workout edited successfully",
				}),
			});
		},
		delete: async () => {
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
		},
	});
});

const deleteSchema = z.object({
	workoutId: z.string().optional(),
	templateId: z.string().optional(),
	entity: z.nativeEnum(FitnessEntity),
});

const editWorkoutSchema = z.object({
	startTime: z.string(),
	endTime: z.string(),
	id: z.string(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const submit = useConfirmSubmit();
	const unitSystem = useUserUnitSystem();
	const [
		adjustTimeModalOpened,
		{ open: adjustTimeModalOpen, close: adjustTimeModalClose },
	] = useDisclosure(false);
	const [isWorkoutLoading, setIsWorkoutLoading] = useState(false);
	const startWorkout = useGetWorkoutStarter();
	const [_a, setAddEntityToCollectionData] = useAddEntityToCollection();
	const entityLot = match(loaderData.entity)
		.with(FitnessEntity.Workouts, () => EntityLot.Workout)
		.with(FitnessEntity.Templates, () => EntityLot.WorkoutTemplate)
		.exhaustive();

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
			loaderData.information,
			coreDetails,
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
								label="Start time"
								required
								name="startTime"
								defaultValue={new Date(loaderData.startTime)}
							/>
							<DateTimePicker
								label="End time"
								required
								name="endTime"
								defaultValue={new Date(loaderData.endTime)}
							/>
							<Button
								variant="outline"
								type="submit"
								name="id"
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
													if (!coreDetails.isPro) {
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
									onClick={() =>
										setAddEntityToCollectionData({
											entityLot,
											entityId: loaderData.entityId,
											alreadyInCollections: loaderData.collections.map(
												(c) => c.id,
											),
										})
									}
									leftSection={<IconArchive size={14} />}
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
										onClick={async (e) => {
											const form = e.currentTarget.form;
											e.preventDefault();
											const conf = await confirmWrapper({
												confirmation: `Are you sure you want to delete this ${loaderData.entity}? This action is not reversible.`,
											});
											if (conf && form) submit(form);
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
								<DisplayCollection
									col={col}
									key={col.id}
									entityLot={entityLot}
									creatorUserId={col.userId}
									entityId={loaderData.entityId}
								/>
							))}
						</Group>
					) : null}
					{loaderData.repeatedWorkout ? (
						<Box>
							<Text c="dimmed" span>
								Repeated from{" "}
							</Text>
							<Anchor
								component={Link}
								to={$path("/fitness/:entity/:id", {
									entity: "workouts",
									id: loaderData.repeatedWorkout.id,
								})}
							>
								{loaderData.repeatedWorkout.name}
							</Anchor>
							<Text c="dimmed" span>
								{" "}
								on {dayjsLib(loaderData.repeatedWorkout.doneOn).format("LLL")}
							</Text>
						</Box>
					) : null}
					{loaderData.template ? (
						<Box>
							<Text c="dimmed" span>
								Template used:
							</Text>{" "}
							<Anchor
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
						<Text span>{dayjsLib(loaderData.startTime).format("LLL")}</Text>
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
											icon={<IconRun size={16} />}
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
								</>
							) : null}
						</SimpleGrid>
					</Box>
					{loaderData.information.comment ? (
						<Box>
							<Text c="dimmed" span>
								Commented:{" "}
							</Text>
							<Text span>{loaderData.information.comment}</Text>
						</Box>
					) : null}
					{loaderData.information.exercises.map((exercise, idx) => (
						<ExerciseHistory
							exerciseIdx={idx}
							entityId={loaderData.entityId}
							key={`${exercise.name}-${idx}`}
							entityType={loaderData.entity}
							supersetInformation={loaderData.information.supersets}
						/>
					))}
				</Stack>
			</Container>
		</>
	);
}

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
