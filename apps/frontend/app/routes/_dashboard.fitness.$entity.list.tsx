import {
	Accordion,
	ActionIcon,
	Anchor,
	Box,
	Center,
	Container,
	Flex,
	Group,
	Pagination,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { unstable_defineLoader } from "@remix-run/node";
import {
	Link,
	type MetaArgs_SingleFetch,
	useLoaderData,
} from "@remix-run/react";
import {
	UserWorkoutTemplatesListDocument,
	UserWorkoutsListDocument,
	type WorkoutSummary,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, humanizeDuration, truncate } from "@ryot/ts-utils";
import {
	IconClock,
	IconLink,
	IconLock,
	IconPlus,
	IconTrophy,
	IconWeight,
} from "@tabler/icons-react";
import type { ReactElement } from "react";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { DebouncedSearchInput } from "~/components/common";
import {
	displayWeightWithUnit,
	getSetStatisticsTextToDisplay,
} from "~/components/fitness";
import { FitnessEntity, dayjsLib } from "~/lib/generals";
import {
	useAppSearchParam,
	useCoreDetails,
	useGetWorkoutStarter,
	useUserUnitSystem,
} from "~/lib/hooks";
import { getDefaultWorkout } from "~/lib/state/fitness";
import {
	getEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ params, request }) => {
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
				{ input: { page: query.page, query: query.query } },
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
	return { query, entity, itemList, cookieName };
});

export const meta = ({ data }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${changeCase(data?.entity || "")} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const startWorkout = useGetWorkoutStarter();
	const unitSystem = useUserUnitSystem();

	return (
		<Container size="xs">
			<Stack>
				<Flex align="center" gap="md">
					<Title>{changeCase(loaderData.entity)}</Title>
					<ActionIcon
						color="green"
						variant="outline"
						onClick={() => {
							startWorkout(getDefaultWorkout(), loaderData.entity);
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
					<>
						<Accordion multiple chevronPosition="left">
							{loaderData.itemList.items.map((workout) => (
								<Accordion.Item
									key={workout.id}
									value={workout.id}
									data-workout-id={workout.id}
								>
									<Center>
										<Accordion.Control>
											<Group wrap="nowrap">
												<Text fz={{ base: "sm", md: "md" }}>
													{truncate(workout.name, { length: 20 })}
												</Text>
												<Text fz={{ base: "xs", md: "sm" }} c="dimmed">
													{dayjsLib(workout.timestamp).format("LL")}
												</Text>
											</Group>
											<Stack mt="xs" gap={1}>
												{workout.detail ? (
													<DisplayStat
														icon={match(loaderData.entity)
															.with(FitnessEntity.Workouts, () => (
																<IconClock size={16} />
															))
															.with(FitnessEntity.Templates, () => (
																<IconLock size={16} />
															))
															.exhaustive()}
														data={workout.detail}
													/>
												) : null}
												{workout.summary.total ? (
													<Group>
														<DisplayStat
															icon={<IconWeight size={16} />}
															data={displayWeightWithUnit(
																unitSystem,
																workout.summary.total.weight,
															)}
														/>
														{Number(
															workout.summary.total.personalBestsAchieved,
														) !== 0 ? (
															<DisplayStat
																icon={<IconTrophy size={16} />}
																data={`${workout.summary.total.personalBestsAchieved} PRs`}
															/>
														) : null}
													</Group>
												) : null}
											</Stack>
										</Accordion.Control>
										<Anchor
											component={Link}
											to={$path("/fitness/:entity/:id", {
												entity: loaderData.entity,
												id: workout.id,
											})}
											pr="md"
										>
											<Text fz="xs" ta="right" visibleFrom="sm">
												View details
											</Text>
											<Box hiddenFrom="sm">
												<IconLink size={16} />
											</Box>
										</Anchor>
									</Center>
									<Accordion.Panel>
										<Group justify="space-between">
											<Text fw="bold">Exercise</Text>
											{loaderData.entity === FitnessEntity.Workouts ? (
												<Text fw="bold">Best set</Text>
											) : null}
										</Group>
										{workout.summary.exercises.map((exercise, idx) => (
											<ExerciseDisplay
												exercise={exercise}
												key={`${idx}-${exercise.id}`}
											/>
										))}
									</Accordion.Panel>
								</Accordion.Item>
							))}
						</Accordion>
					</>
				) : (
					<Text>No {loaderData.entity} found</Text>
				)}
				<Center>
					<Pagination
						size="sm"
						value={loaderData.query.page}
						onChange={(v) => setP("page", v.toString())}
						total={Math.ceil(
							loaderData.itemList.details.total / coreDetails.pageLimit,
						)}
					/>
				</Center>
			</Stack>
		</Container>
	);
}

const DisplayStat = (props: { icon: ReactElement; data: string }) => {
	return (
		<Flex gap={4} align="center">
			{props.icon}
			<Text size="sm" span>
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
				{props.exercise.id}
			</Text>
			{stat ? <Text fz="sm">{stat}</Text> : null}
		</Flex>
	);
};
