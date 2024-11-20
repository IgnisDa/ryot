import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Sparkline } from "@mantine/charts";
import {
	ActionIcon,
	Anchor,
	Box,
	Center,
	Container,
	Divider,
	Flex,
	Group,
	Pagination,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
	UserWorkoutDetailsDocument,
	UserWorkoutTemplateDetailsDocument,
	UserWorkoutTemplatesListDocument,
	UserWorkoutsListDocument,
	type WorkoutSummary,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, humanizeDuration, truncate } from "@ryot/ts-utils";
import {
	IconChevronDown,
	IconChevronUp,
	IconClock,
	IconLock,
	IconPlus,
	IconRoad,
	IconTrophy,
	IconWeight,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { DebouncedSearchInput } from "~/components/common";
import {
	displayDistanceWithUnit,
	displayWeightWithUnit,
	getSetStatisticsTextToDisplay,
} from "~/components/fitness";
import {
	FitnessAction,
	FitnessEntity,
	PRO_REQUIRED_MESSAGE,
	clientGqlService,
	dayjsLib,
	pageQueryParam,
} from "~/lib/generals";
import {
	useAppSearchParam,
	useCoreDetails,
	useGetWorkoutStarter,
	useUserUnitSystem,
} from "~/lib/hooks";
import { getDefaultWorkout } from "~/lib/state/fitness";
import {
	getEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	[pageQueryParam]: zx.IntAsString.default("1"),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
	const { entity } = zx.parseParams(params, {
		entity: z.nativeEnum(FitnessEntity),
	});
	const cookieName = await getEnhancedCookieName(`${entity}.list`, request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = zx.parseQuery(request, searchParamsSchema);
	const itemList = await match(entity)
		.with(FitnessEntity.Workouts, async () => {
			const { userWorkoutsList } = await serverGqlService.authenticatedRequest(
				request,
				UserWorkoutsListDocument,
				{ input: { page: query[pageQueryParam], query: query.query } },
			);
			return {
				details: userWorkoutsList.details,
				items: userWorkoutsList.items.map((w) => ({
					id: w.id,
					name: w.name,
					timestamp: w.startTime,
					detail: humanizeDuration(
						dayjsLib.duration(w.duration, "second").asMilliseconds(),
						{
							round: true,
							units: ["h", "m"],
						},
					),
					summary: w.summary,
				})),
			};
		})
		.with(FitnessEntity.Templates, async () => {
			const { userWorkoutTemplatesList } =
				await serverGqlService.authenticatedRequest(
					request,
					UserWorkoutTemplatesListDocument,
					{ input: { page: query.page, query: query.query } },
				);
			return {
				details: userWorkoutTemplatesList.details,
				items: userWorkoutTemplatesList.items.map((w) => ({
					id: w.id,
					name: w.name,
					timestamp: w.createdOn,
					detail: changeCase(w.visibility),
					summary: w.summary,
				})),
			};
		})
		.exhaustive();
	const totalPages = await redirectToFirstPageIfOnInvalidPage(
		request,
		itemList.details.total,
		query[pageQueryParam],
	);
	return { query, entity, itemList, cookieName, totalPages };
};

export const meta = ({ data }: MetaArgs<typeof loader>) => {
	return [{ title: `${changeCase(data?.entity || "")} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const startWorkout = useGetWorkoutStarter();

	return (
		<Container size="xs">
			<Stack>
				<Flex align="center" gap="md">
					<Title>{changeCase(loaderData.entity)}</Title>
					<ActionIcon
						color="green"
						variant="outline"
						onClick={() => {
							if (
								!coreDetails.isPro &&
								loaderData.entity === FitnessEntity.Templates
							) {
								notifications.show({
									color: "red",
									message: PRO_REQUIRED_MESSAGE,
								});
								return;
							}
							const action = match(loaderData.entity)
								.with(FitnessEntity.Workouts, () => FitnessAction.LogWorkout)
								.with(
									FitnessEntity.Templates,
									() => FitnessAction.CreateTemplate,
								)
								.exhaustive();
							startWorkout(getDefaultWorkout(action), action);
						}}
					>
						<IconPlus size={16} />
					</ActionIcon>
				</Flex>
				<DebouncedSearchInput
					placeholder={`Search for ${loaderData.entity}`}
					initialValue={loaderData.query.query}
					enhancedQueryParams={loaderData.cookieName}
				/>
				{loaderData.itemList.items.length > 0 ? (
					<Stack gap="xs">
						{loaderData.itemList.items.map((workout, index) => (
							<DisplayWorkoutListItem
								index={index}
								data={workout}
								key={workout.id}
							/>
						))}
					</Stack>
				) : (
					<Text>No {loaderData.entity} found</Text>
				)}
				<Center>
					<Pagination
						size="sm"
						total={loaderData.totalPages}
						value={loaderData.query[pageQueryParam]}
						onChange={(v) => setP(pageQueryParam, v.toString())}
					/>
				</Center>
			</Stack>
		</Container>
	);
}

type DataItem = Awaited<ReturnType<typeof loader>>["itemList"]["items"][number];

const DisplayWorkoutListItem = ({
	data,
	index,
}: { data: DataItem; index: number }) => {
	const loaderData = useLoaderData<typeof loader>();
	const unitSystem = useUserUnitSystem();
	const [parent] = useAutoAnimate();
	const [showDetails, setShowDetails] = useDisclosure(false);

	const { data: entityInformation } = useQuery({
		queryKey: ["fitnessEntityDetails", data.id],
		queryFn: () =>
			match(loaderData.entity)
				.with(FitnessEntity.Workouts, () =>
					clientGqlService
						.request(UserWorkoutDetailsDocument, { workoutId: data.id })
						.then((data) => data.userWorkoutDetails.details.information),
				)
				.with(FitnessEntity.Templates, () =>
					clientGqlService
						.request(UserWorkoutTemplateDetailsDocument, {
							workoutTemplateId: data.id,
						})
						.then(
							(data) => data.userWorkoutTemplateDetails.details.information,
						),
				)
				.exhaustive(),
	});

	const personalBestsAchieved = data.summary.total?.personalBestsAchieved || 0;
	const repsData = (entityInformation?.exercises || [])
		.map((e) => Number.parseInt(e.total?.reps || "0"))
		.filter(Boolean);

	return (
		<>
			{index !== 0 ? <Divider /> : null}
			<Stack
				gap="xs"
				ref={parent}
				key={data.id}
				data-workout-id={data.id}
				px={{ base: "xs", md: "md" }}
			>
				<Group wrap="nowrap" justify="space-between">
					<Box>
						<Group wrap="nowrap">
							<Anchor
								component={Link}
								fz={{ base: "sm", md: "md" }}
								to={$path("/fitness/:entity/:id", {
									entity: loaderData.entity,
									id: data.id,
								})}
							>
								{truncate(data.name, { length: 20 })}
							</Anchor>
							<Text fz={{ base: "xs", md: "sm" }} c="dimmed">
								{dayjsLib(data.timestamp).format("LL")}
							</Text>
						</Group>
						<Group mt="xs">
							{data.detail ? (
								<DisplayStat
									icon={match(loaderData.entity)
										.with(FitnessEntity.Workouts, () => <IconClock size={16} />)
										.with(FitnessEntity.Templates, () => <IconLock size={16} />)
										.exhaustive()}
									data={data.detail}
								/>
							) : null}
							{data.summary.total ? (
								<>
									{personalBestsAchieved !== 0 ? (
										<DisplayStat
											icon={<IconTrophy size={16} />}
											data={`${personalBestsAchieved} PR${
												personalBestsAchieved > 1 ? "s" : ""
											}`}
										/>
									) : null}
									{Number(data.summary.total.weight) !== 0 ? (
										<DisplayStat
											icon={<IconWeight size={16} />}
											data={displayWeightWithUnit(
												unitSystem,
												data.summary.total.weight,
											)}
										/>
									) : null}
									{Number(data.summary.total.distance) !== 0 ? (
										<Box visibleFrom="md">
											<DisplayStat
												icon={<IconRoad size={16} />}
												data={displayDistanceWithUnit(
													unitSystem,
													data.summary.total.distance,
												)}
											/>
										</Box>
									) : null}
								</>
							) : null}
						</Group>
					</Box>
					<ActionIcon onClick={() => setShowDetails.toggle()}>
						{showDetails ? (
							<IconChevronUp size={16} />
						) : (
							<IconChevronDown size={16} />
						)}
					</ActionIcon>
				</Group>
				{repsData.length >= 3 ? (
					<Sparkline h="60" data={repsData} color="teal" />
				) : null}
				{showDetails ? (
					<Box px={{ base: "xs", md: "md" }}>
						<Group justify="space-between">
							<Text fw="bold">Exercise</Text>
							{loaderData.entity === FitnessEntity.Workouts ? (
								<Text fw="bold">Best set</Text>
							) : null}
						</Group>
						{data.summary.exercises.map((exercise, idx) => (
							<ExerciseDisplay
								exercise={exercise}
								key={`${idx}-${exercise.name}`}
							/>
						))}
					</Box>
				) : null}
			</Stack>
		</>
	);
};

const DisplayStat = (props: { icon: ReactElement; data: string }) => {
	return (
		<Flex gap={4} align="center">
			{props.icon}
			<Text fz={{ base: "xs", md: "sm" }} span>
				{props.data}
			</Text>
		</Flex>
	);
};

const ExerciseDisplay = (props: {
	exercise: WorkoutSummary["exercises"][number];
}) => {
	const unitSystem = useUserUnitSystem();
	const stat = match(props.exercise.bestSet)
		.with(undefined, null, () => {})
		.otherwise((value) => {
			invariant(props.exercise.lot);
			const [stat] = getSetStatisticsTextToDisplay(
				props.exercise.lot,
				value.statistic,
				unitSystem,
			);
			return stat;
		});

	return (
		<Flex gap="xs">
			<Text fz="sm" ff="monospace">
				{props.exercise.numSets} ×
			</Text>
			<Text style={{ flex: 1 }} fz="sm">
				{props.exercise.name}
			</Text>
			{stat ? <Text fz="sm">{stat}</Text> : null}
		</Flex>
	);
};
