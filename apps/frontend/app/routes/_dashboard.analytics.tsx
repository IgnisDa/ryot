import { BarChart, PieChart, RadarChart } from "@mantine/charts";
import {
	Button,
	Center,
	Container,
	Flex,
	Grid,
	Group,
	Loader,
	Menu,
	Modal,
	NumberInput,
	Paper,
	SimpleGrid,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import {
	DailyUserActivitiesResponseGroupedBy,
	UserAnalyticsDocument,
	UserAnalyticsParametersDocument,
	type UserAnalyticsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	formatDateToNaiveDate,
	formatQuantityWithCompactNotation,
	humanizeDuration,
	isBoolean,
	mapValues,
	pickBy,
	snakeCase,
	sum,
} from "@ryot/ts-utils";
import {
	IconBarbell,
	IconClock,
	IconDeviceFloppy,
	IconFlame,
	IconImageInPicture,
	type IconProps,
	IconRepeat,
	IconRoad,
	IconRulerMeasure,
	IconStretching,
	IconTrophy,
	IconWeight,
	IconZzz,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import html2canvas from "html2canvas";
import { produce } from "immer";
import { atom, useAtom } from "jotai";
import { type ComponentType, type ReactNode, useRef, useState } from "react";
import { useLoaderData } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import { match } from "ts-pattern";
import { useLocalStorage } from "usehooks-ts";
import { ProRequiredAlert } from "~/components/common";
import {
	displayDistanceWithUnit,
	displayWeightWithUnit,
} from "~/components/fitness/utils";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import {
	convertUtcHourToLocalHour,
	dayjsLib,
	getStartTimeFromRange,
} from "~/lib/shared/date-utils";
import {
	useCoreDetails,
	useGetMantineColors,
	useUserPreferences,
	useUserUnitSystem,
} from "~/lib/shared/hooks";
import { MediaColors } from "~/lib/shared/media-utils";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import { selectRandomElement, triggerDownload } from "~/lib/shared/ui-utils";
import { ApplicationTimeRange } from "~/lib/types";
import { serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.analytics";

export type TimeSpanSettings = {
	endDate?: string;
	startDate?: string;
	range: ApplicationTimeRange;
};

export const loader = async ({ request }: Route.LoaderArgs) => {
	const { userAnalyticsParameters } =
		await serverGqlService.authenticatedRequest(
			request,
			UserAnalyticsParametersDocument,
		);
	return { userAnalyticsParameters };
};

export const meta = () => {
	return [{ title: "Analytics | Ryot" }];
};

const useTimeSpanSettings = () => {
	const loaderData = useLoaderData<typeof loader>();
	const [timeSpanSettings, setTimeSpanSettings] =
		useLocalStorage<TimeSpanSettings>("TimeSpanSettings", {
			range: ApplicationTimeRange.Past30Days,
		});

	const startDate =
		timeSpanSettings.startDate ||
		(timeSpanSettings.range === "All Time" &&
			loaderData.userAnalyticsParameters.response.startDate) ||
		formatDateToNaiveDate(
			getStartTimeFromRange(timeSpanSettings.range) || new Date(),
		);

	const endDate =
		timeSpanSettings.endDate ||
		(timeSpanSettings.range === "All Time" &&
			loaderData.userAnalyticsParameters.response.endDate) ||
		formatDateToNaiveDate(dayjsLib());
	return { timeSpanSettings, setTimeSpanSettings, startDate, endDate };
};

const useGetUserAnalytics = () => {
	const { startDate, endDate } = useTimeSpanSettings();
	const input = { dateRange: { startDate, endDate } };

	const userAnalytics = useQuery({
		queryKey: queryFactory.miscellaneous.userAnalytics(input).queryKey,
		queryFn: async () => {
			return await clientGqlService
				.request(UserAnalyticsDocument, { input })
				.then((data) => data.userAnalytics.response);
		},
	});
	return userAnalytics;
};

const isCaptureLoadingAtom = atom(false);

export default function Page() {
	const coreDetails = useCoreDetails();
	const userAnalytics = useGetUserAnalytics();
	const toCaptureRef = useRef<HTMLDivElement>(null);
	const [customRangeOpened, setCustomRangeOpened] = useState(false);
	const [isCaptureLoading, setIsCaptureLoading] = useAtom(isCaptureLoadingAtom);
	const { timeSpanSettings, setTimeSpanSettings, startDate, endDate } =
		useTimeSpanSettings();

	return (
		<>
			<CustomDateSelectModal
				opened={customRangeOpened}
				onClose={() => setCustomRangeOpened(false)}
			/>
			<Container
				py="md"
				ref={toCaptureRef}
				style={{ backgroundColor: "var(--mantine-color-body)" }}
			>
				<Stack>
					<SimpleGrid cols={{ base: 2 }} style={{ alignItems: "center" }}>
						<Text fz={{ base: "lg", md: "h1" }} fw="bold">
							Analytics
						</Text>
						<ClientOnly>
							{() => (
								<Menu position="bottom-end">
									<Menu.Target>
										<Button
											w={{ md: 200 }}
											variant="default"
											ml={{ md: "auto" }}
											loading={userAnalytics.isFetching}
										>
											<Stack gap={0}>
												<Text size="xs">{timeSpanSettings.range}</Text>
												<Text span c="dimmed" size="xs">
													{startDate} to {endDate}
												</Text>
											</Stack>
										</Button>
									</Menu.Target>
									<Menu.Dropdown>
										{Object.values(ApplicationTimeRange).map((range) => (
											<Menu.Item
												ta="right"
												key={range}
												color={
													timeSpanSettings.range === range ? "blue" : undefined
												}
												onClick={() => {
													if (range === "Custom")
														return setCustomRangeOpened(true);
													setTimeSpanSettings(
														produce(timeSpanSettings, (draft) => {
															draft.range = range;
															draft.startDate = undefined;
															draft.endDate = undefined;
														}),
													);
												}}
											>
												{range}
											</Menu.Item>
										))}
									</Menu.Dropdown>
								</Menu>
							)}
						</ClientOnly>
					</SimpleGrid>
					{!coreDetails.isServerKeyValidated &&
					![
						ApplicationTimeRange.Yesterday,
						ApplicationTimeRange.Past7Days,
						ApplicationTimeRange.Past30Days,
					].includes(timeSpanSettings.range) ? (
						<ProRequiredAlert />
					) : (
						<Grid>
							<Grid.Col span={{ base: 12, md: 6 }}>
								<MusclesChart />
							</Grid.Col>
							<Grid.Col span={{ base: 12, md: 6 }}>
								<ExercisesChart />
							</Grid.Col>
							<Grid.Col span={{ base: 12, md: 6 }}>
								<StatisticsCard />
							</Grid.Col>
							<Grid.Col span={{ base: 12, md: 6 }}>
								<TimeOfDayChart />
							</Grid.Col>
							<Grid.Col span={12}>
								<ActivitySection />
							</Grid.Col>
						</Grid>
					)}
					{isCaptureLoading ? (
						<Text ta="right" size="xs" c="dimmed">
							Generated using Ryot (https://ryot.io)
						</Text>
					) : null}
				</Stack>
			</Container>
			<Container>
				<Flex w="100%" mt="md">
					<Button
						mr="md"
						ml="auto"
						variant="default"
						loading={isCaptureLoading}
						leftSection={<IconImageInPicture />}
						onClick={() => {
							if (!coreDetails.isServerKeyValidated)
								return notifications.show({
									color: "red",
									title: "Pro required",
									message: PRO_REQUIRED_MESSAGE,
								});
							const current = toCaptureRef.current;
							if (!current) return;
							setIsCaptureLoading(true);
							setTimeout(async () => {
								let downloadUrl: string | undefined;
								try {
									const canvas = await html2canvas(current);
									const dataUrl = canvas.toDataURL("image/png");
									let blob: Blob;
									if (canvas.toBlob) {
										blob = await new Promise<Blob>((resolve, reject) => {
											canvas.toBlob((value) => {
												if (value) return resolve(value);
												reject(new Error("Failed to create canvas blob"));
											}, "image/png");
										});
									} else {
										blob = await fetch(dataUrl).then((response) =>
											response.blob(),
										);
									}
									downloadUrl = URL.createObjectURL(blob);
									triggerDownload(downloadUrl, "download.png");
								} catch {
									notifications.show({
										color: "red",
										title: "Error",
										message: "Something went wrong while capturing the image",
									});
								} finally {
									if (downloadUrl) URL.revokeObjectURL(downloadUrl);
									setIsCaptureLoading(false);
								}
							}, 1500);
						}}
					>
						Save image
					</Button>
				</Flex>
			</Container>
		</>
	);
}

const DisplayStat = (props: { label: string; value: string | number }) => {
	return (
		<Stack gap={4}>
			<Text c="dimmed">{props.label}</Text>
			<Text size="xl" fw="bolder">
				{props.value}
			</Text>
		</Stack>
	);
};

const ActivitySection = () => {
	const userAnalytics = useGetUserAnalytics();
	const dailyUserActivities = userAnalytics?.data?.activities;
	const trackSeries = mapValues(MediaColors, () => false);

	const data = dailyUserActivities?.items.map((d) => {
		const data = Object.entries(d)
			.filter(([_, value]) => value !== 0)
			.map(([key, value]) => ({
				[snakeCase(
					key.replace("Count", "").replace("total", ""),
				).toUpperCase()]: value,
			}))
			.reduce(Object.assign, {});
		for (const key in data)
			if (isBoolean(trackSeries[key])) trackSeries[key] = true;
		return data;
	});
	const series = pickBy(trackSeries);
	const dailyUserActivitiesData = dailyUserActivities
		? {
				data,
				series,
				groupedBy: dailyUserActivities.groupedBy,
				totalCount: dailyUserActivities.totalCount,
				totalDuration: dailyUserActivities.totalDuration,
			}
		: undefined;

	const items = dailyUserActivitiesData?.totalCount || 0;

	return (
		<Paper p={items === 0 ? "md" : undefined} withBorder={items === 0}>
			<Stack h={{ base: 500, md: 400 }}>
				<SimpleGrid cols={{ base: 2, md: 3 }} mx={{ md: "xl" }}>
					<DisplayStat
						label="Total"
						value={`${formatQuantityWithCompactNotation(Number(items))} items`}
					/>
					<DisplayStat
						label="Duration"
						value={
							dailyUserActivitiesData
								? humanizeDuration(
										dayjsLib
											.duration(
												dailyUserActivitiesData.totalDuration,
												"minutes",
											)
											.asMilliseconds(),
										{ largest: 2 },
									)
								: "N/A"
						}
					/>
				</SimpleGrid>
				{dailyUserActivitiesData ? (
					dailyUserActivitiesData.totalCount !== 0 &&
					dailyUserActivitiesData.data ? (
						<BarChart
							h="100%"
							w="100%"
							ml={-15}
							withLegend
							tickLine="x"
							dataKey="DAY"
							type="stacked"
							data={dailyUserActivitiesData.data}
							legendProps={{ verticalAlign: "bottom" }}
							series={Object.keys(dailyUserActivitiesData.series).map(
								(lot) => ({
									name: lot,
									color: MediaColors[lot],
									label: changeCase(lot),
								}),
							)}
							xAxisProps={{
								tickFormatter: (v) =>
									dayjsLib(v).format(
										match(dailyUserActivitiesData.groupedBy)
											.with(
												DailyUserActivitiesResponseGroupedBy.Day,
												() => "MMM D",
											)
											.with(
												DailyUserActivitiesResponseGroupedBy.Month,
												() => "MMM",
											)
											.with(
												DailyUserActivitiesResponseGroupedBy.Year,
												DailyUserActivitiesResponseGroupedBy.AllTime,
												() => "YYYY",
											)
											.exhaustive(),
									),
							}}
						/>
					) : (
						<Center h="100%">
							<Text m="auto" ta="center">
								No activity found in the selected period
							</Text>
						</Center>
					)
				) : (
					<Center h="100%">
						<Loader />
					</Center>
				)}
			</Stack>
		</Paper>
	);
};

const CustomDateSelectModal = (props: {
	opened: boolean;
	onClose: () => void;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const { timeSpanSettings, setTimeSpanSettings, startDate, endDate } =
		useTimeSpanSettings();
	const [value, setValue] = useState<[string | null, string | null]>([
		startDate,
		endDate,
	]);

	return (
		<Modal
			opened={props.opened}
			title="Select custom date range"
			onClose={props.onClose}
		>
			<Stack>
				<DatePicker
					mx="auto"
					size="md"
					type="range"
					value={value}
					w="fit-content"
					onChange={setValue}
					minDate={dayjsLib(
						loaderData.userAnalyticsParameters.response.startDate,
					).toDate()}
					maxDate={dayjsLib(
						loaderData.userAnalyticsParameters.response.endDate,
					).toDate()}
				/>
				<Button
					variant="default"
					leftSection={<IconDeviceFloppy />}
					onClick={() => {
						setTimeSpanSettings(
							produce(timeSpanSettings, (draft) => {
								draft.startDate = formatDateToNaiveDate(
									value[0] ? new Date(value[0]) : new Date(),
								);
								draft.endDate = formatDateToNaiveDate(
									value[1] ? new Date(value[1]) : new Date(),
								);
								draft.range = ApplicationTimeRange.Custom;
							}),
						);
						props.onClose();
					}}
				>
					Apply
				</Button>
			</Stack>
		</Modal>
	);
};

const MusclesChart = () => {
	const colors = useGetMantineColors();

	return (
		<ChartContainer title="Muscles worked out">
			{(count, { fitness }) => ({
				totalItems: fitness.workoutMuscles.length,
				render: (
					<PieChart
						size={250}
						withLabels
						withTooltip
						strokeWidth={0.5}
						labelsType="percent"
						tooltipDataSource="segment"
						data={fitness.workoutMuscles.slice(0, count).map((item) => ({
							value: item.count,
							name: changeCase(item.muscle),
							color: selectRandomElement(colors, item.muscle),
						}))}
					/>
				),
			})}
		</ChartContainer>
	);
};

const ExercisesChart = () => {
	const colors = useGetMantineColors();

	return (
		<ChartContainer title="Exercises done">
			{(count, { fitness }) => ({
				totalItems: fitness.workoutExercises.length,
				render: (
					<BarChart
						h={300}
						withTooltip
						dataKey="name"
						gridAxis="none"
						tickLine="none"
						tooltipAnimationDuration={500}
						series={[{ name: "value", label: "Times done" }]}
						data={fitness.workoutExercises.slice(0, count).map((item) => ({
							value: item.count,
							name: changeCase(item.exercise),
							color: selectRandomElement(colors, item.exercise),
						}))}
					/>
				),
			})}
		</ChartContainer>
	);
};

const TimeOfDayChart = () => {
	return (
		<ChartContainer title="Time of day" disableCounter>
			{(_, data) => {
				const trackSeries = new Set<string>();
				const allHours = Array.from({ length: 24 }, (_, h) => h).map((h) => {
					const obj: Record<string, string | number> = { hour: h };
					for (const mKey in MediaColors) {
						const count =
							data.hours
								.find((d) => d.hour === h)
								?.entities.filter(
									(e) => e.entityLot === mKey || (e.metadataLot || "") === mKey,
								).length || 0;
						obj[mKey] = count;
						if (count > 0) trackSeries.add(mKey);
					}
					obj.hour = dayjsLib()
						.hour(convertUtcHourToLocalHour(h))
						.format("h a");
					return obj;
				});
				const filteredHours = allHours.filter(
					(h) =>
						sum(
							Object.entries(h)
								.filter((a) => a[0] !== "hour")
								.map((f) => f[1]),
						) > 0,
				);
				return {
					totalItems: filteredHours.length,
					render: (
						<RadarChart
							h={300}
							w="100%"
							dataKey="hour"
							withPolarRadiusAxis
							data={filteredHours}
							series={[...trackSeries].map((key) => ({
								name: key,
								opacity: 0.3,
								color: MediaColors[key],
							}))}
						/>
					),
				};
			}}
		</ChartContainer>
	);
};

const StatItem = (props: {
	text: string;
	label: string;
	tooltipLabel: string | number;
	icon: ComponentType<IconProps>;
}) => {
	return (
		<Tooltip label={props.tooltipLabel}>
			<Stack align="center" justify="center" gap={0}>
				<props.icon size={20} />
				<Text size="sm" c="dimmed" ta="center">
					{props.label}
				</Text>
				<Text size="xl" fw="bold" ta="center">
					{props.text}
				</Text>
			</Stack>
		</Tooltip>
	);
};

const StatisticsCard = () => {
	const unitSystem = useUserUnitSystem();
	const userPreferences = useUserPreferences();

	const displayDuration = (duration: number) => {
		return humanizeDuration(
			dayjsLib.duration(duration, "minutes").asMilliseconds(),
			{ largest: 1 },
		);
	};

	return (
		<ChartContainer title="Fitness Statistics" disableCounter>
			{(_, { fitness }) => ({
				totalItems: fitness.workoutCount + fitness.measurementCount,
				render: (
					<SimpleGrid
						cols={3}
						h="100%"
						w="100%"
						p={{ md: "xl" }}
						py={{ base: "md", md: "auto" }}
					>
						<StatItem
							label="Workouts"
							icon={IconStretching}
							text={`${fitness.workoutCount}`}
							tooltipLabel={fitness.workoutCount}
						/>
						<StatItem
							label={
								fitness.workoutCaloriesBurnt > 0
									? `${userPreferences.fitness.logging.caloriesBurntUnit}`
									: "Reps"
							}
							icon={fitness.workoutCaloriesBurnt > 0 ? IconFlame : IconRepeat}
							tooltipLabel={
								fitness.workoutCaloriesBurnt > 0
									? `${fitness.workoutCaloriesBurnt} calories`
									: fitness.workoutReps
							}
							text={formatQuantityWithCompactNotation(
								fitness.workoutCaloriesBurnt > 0
									? fitness.workoutCaloriesBurnt
									: fitness.workoutReps,
							)}
						/>
						<StatItem
							label="Weight"
							icon={IconWeight}
							tooltipLabel={displayWeightWithUnit(
								unitSystem,
								fitness.workoutWeight,
							)}
							text={displayWeightWithUnit(
								unitSystem,
								fitness.workoutWeight,
								true,
							)}
						/>
						<StatItem
							icon={IconRoad}
							label="Distance"
							tooltipLabel={displayDistanceWithUnit(
								unitSystem,
								fitness.workoutDistance,
							)}
							text={displayDistanceWithUnit(
								unitSystem,
								fitness.workoutDistance,
								true,
							)}
						/>
						<StatItem
							label="Duration"
							icon={IconClock}
							tooltipLabel={`${fitness.workoutDuration}s`}
							text={displayDuration(fitness.workoutDuration)}
						/>
						<StatItem
							label="Exercises"
							icon={IconBarbell}
							text={`${fitness.workoutExercises.length}`}
							tooltipLabel={fitness.workoutExercises.length}
						/>
						<StatItem
							icon={IconTrophy}
							label="Personal Bests"
							text={`${fitness.workoutPersonalBests}`}
							tooltipLabel={fitness.workoutPersonalBests}
						/>
						<StatItem
							icon={IconZzz}
							label="Rest Time"
							tooltipLabel={`${fitness.workoutRestTime}s`}
							text={displayDuration(fitness.workoutRestTime)}
						/>
						<StatItem
							label="Measurements"
							icon={IconRulerMeasure}
							text={`${fitness.measurementCount}`}
							tooltipLabel={fitness.measurementCount}
						/>
					</SimpleGrid>
				),
			})}
		</ChartContainer>
	);
};

type ChartContainerProps = {
	title: string;
	disableCounter?: boolean;
	children: (
		count: number,
		data: UserAnalyticsQuery["userAnalytics"]["response"],
	) => {
		render: ReactNode;
		totalItems: number;
	};
};

const ChartContainer = (props: ChartContainerProps) => {
	const [count, setCount] = useLocalStorage(
		`FitnessChartContainer-${props.title}`,
		10,
	);
	const userPreferences = useUserPreferences();
	const [isCaptureLoading] = useAtom(isCaptureLoadingAtom);
	const userAnalytics = useGetUserAnalytics();

	const value = userAnalytics.data
		? props.children(count, userAnalytics.data)
		: undefined;

	return userPreferences.featuresEnabled.fitness.enabled ? (
		<Paper display="flex" h={380} withBorder={value?.totalItems === 0} p="md">
			<Flex flex={1} align="center" direction="column" w="100%">
				<Group wrap="nowrap" w="100%" gap="xl" justify="center">
					<Text size="lg" fw="bold">
						{props.title}
					</Text>
					{props.disableCounter ||
					(value?.totalItems || 0) === 0 ||
					isCaptureLoading ? null : (
						<NumberInput
							w={60}
							min={2}
							size="xs"
							value={count}
							max={value?.totalItems}
							onFocus={(e) => e.target.select()}
							onChange={(v) => setCount(Number(v))}
						/>
					)}
				</Group>
				<Flex flex={1} w="100%" justify="center" align="center">
					{value ? (
						value.totalItems > 0 ? (
							value.render
						) : (
							<Text fz="lg" mt="xl">
								No data found
							</Text>
						)
					) : (
						<Loader />
					)}
				</Flex>
			</Flex>
		</Paper>
	) : null;
};
