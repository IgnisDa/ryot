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
} from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import {
	DailyUserActivitiesResponseGroupedBy,
	UserAnalyticsDocument,
	type UserAnalyticsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	formatDateToNaiveDate,
	humanizeDuration,
	isBoolean,
	mapValues,
	pickBy,
	snakeCase,
	sum,
} from "@ryot/ts-utils";
import { IconDeviceFloppy, IconImageInPicture } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import html2canvas from "html2canvas";
import { produce } from "immer";
import { type ReactNode, useRef, useState } from "react";
import { ClientOnly } from "remix-utils/client-only";
import { match } from "ts-pattern";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import {
	MediaColors,
	clientGqlService,
	convertUtcHourToLocalHour,
	dayjsLib,
	queryFactory,
	selectRandomElement,
} from "~/lib/generals";
import { useGetMantineColors, useUserPreferences } from "~/lib/hooks";

const TIME_RANGES = [
	"Yesterday",
	"Past 7 Days",
	"Past 30 Days",
	"Past 6 Months",
	"Past 12 Months",
	"This Week",
	"This Month",
	"This Year",
	"All Time",
	"Custom",
] as const;

const timeSpanSettingsSchema = z.object({
	startDate: z.string().optional(),
	endDate: z.string().optional(),
	range: z.enum(TIME_RANGES),
});

export type TimeSpanSettings = z.infer<typeof timeSpanSettingsSchema>;

const getStartTime = (range: (typeof TIME_RANGES)[number]) =>
	match(range)
		.with("Yesterday", () => dayjsLib().subtract(1, "day"))
		.with("This Week", () => dayjsLib().startOf("week"))
		.with("This Month", () => dayjsLib().startOf("month"))
		.with("This Year", () => dayjsLib().startOf("year"))
		.with("Past 7 Days", () => dayjsLib().subtract(7, "day"))
		.with("Past 30 Days", () => dayjsLib().subtract(30, "day"))
		.with("Past 6 Months", () => dayjsLib().subtract(6, "month"))
		.with("Past 12 Months", () => dayjsLib().subtract(12, "month"))
		.with("All Time", () => dayjsLib().subtract(2000, "year"))
		.with("Custom", () => undefined)
		.exhaustive();

export const loader = async (_args: LoaderFunctionArgs) => {
	return {};
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Fitness Analytics | Ryot" }];
};

const useTimeSpanSettings = () => {
	const [timeSpanSettings, setTimeSpanSettings] =
		useLocalStorage<TimeSpanSettings>("TimeSpanSettings", {
			range: "Past 30 Days",
		});
	const startDate =
		timeSpanSettings.startDate ||
		formatDateToNaiveDate(getStartTime(timeSpanSettings.range) || new Date());

	const endDate = timeSpanSettings.endDate || formatDateToNaiveDate(dayjsLib());
	return { timeSpanSettings, setTimeSpanSettings, startDate, endDate };
};

const useGetUserAnalytics = () => {
	const { startDate, endDate } = useTimeSpanSettings();
	const input = { dateRange: { startDate, endDate } };

	const { data: userAnalytics } = useQuery({
		queryKey: queryFactory.analytics.user({ input }).queryKey,
		queryFn: async () => {
			return await clientGqlService
				.request(UserAnalyticsDocument, { input })
				.then((data) => data.userAnalytics);
		},
	});
	return userAnalytics;
};

export default function Page() {
	const [customRangeOpened, setCustomRangeOpened] = useState(false);
	const [isCaptureLoading, setIsCaptureLoading] = useState(false);
	const toCaptureRef = useRef<HTMLDivElement>(null);
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
										>
											<Stack gap={0}>
												<Text size="xs">{timeSpanSettings.range}</Text>
												{timeSpanSettings.range !== "All Time" ? (
													<Text span c="dimmed" size="xs">
														{startDate} - {endDate}
													</Text>
												) : null}
											</Stack>
										</Button>
									</Menu.Target>
									<Menu.Dropdown>
										{TIME_RANGES.map((range) => (
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
					<Grid>
						<Grid.Col span={{ base: 12, md: 6 }}>
							<MusclesChart />
						</Grid.Col>
						<Grid.Col span={{ base: 12, md: 6 }}>
							<ExercisesChart />
						</Grid.Col>
						<Grid.Col span={{ base: 12, md: 6 }}>
							<TimeOfDayChart />
						</Grid.Col>
						<Grid.Col span={12}>
							<ActivitySection />
						</Grid.Col>
					</Grid>
				</Stack>
			</Container>
			<Flex w="100%" mt="md">
				<Button
					mr="md"
					ml="auto"
					variant="default"
					loading={isCaptureLoading}
					leftSection={<IconImageInPicture />}
					onClick={async () => {
						if (!toCaptureRef.current) return;
						setIsCaptureLoading(true);
						try {
							const canvasPromise = await html2canvas(toCaptureRef.current);
							const dataURL = canvasPromise.toDataURL("image/png");
							const img = new Image();
							img.setAttribute("src", dataURL);
							img.setAttribute("download", dataURL);
							const a = document.createElement("a");
							a.setAttribute("download", dataURL);
							a.setAttribute("href", img.src);
							a.setAttribute("target", "_blank");
							a.innerHTML = "DOWNLOAD";
							document.body.appendChild(a);
							a.click();
						} catch {
							notifications.show({
								color: "red",
								title: "Error",
								message: "Something went wrong while capturing the image",
							});
						} finally {
							setIsCaptureLoading(false);
						}
					}}
				>
					Save image
				</Button>
			</Flex>
		</>
	);
}

const DisplayStat = (props: {
	label: string;
	value: string | number;
}) => {
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
	const dailyUserActivities = userAnalytics?.activities;
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
						value={`${new Intl.NumberFormat("en-US", {
							notation: "compact",
						}).format(Number(items))} items`}
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
												DailyUserActivitiesResponseGroupedBy.Millennium,
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
	const { timeSpanSettings, setTimeSpanSettings, startDate, endDate } =
		useTimeSpanSettings();
	const [value, setValue] = useState<[Date | null, Date | null]>([
		new Date(startDate),
		new Date(endDate),
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
				/>
				<Button
					variant="default"
					leftSection={<IconDeviceFloppy />}
					onClick={() => {
						setTimeSpanSettings(
							produce(timeSpanSettings, (draft) => {
								draft.startDate = formatDateToNaiveDate(value[0] || new Date());
								draft.endDate = formatDateToNaiveDate(value[1] || new Date());
								draft.range = "Custom";
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
					totalItems: allHours.length,
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

type ChartContainerProps = {
	title: string;
	disableCounter?: boolean;
	children: (
		count: number,
		data: UserAnalyticsQuery["userAnalytics"],
	) => {
		render: ReactNode;
		totalItems: number;
	};
};

const ChartContainer = (props: ChartContainerProps) => {
	const userPreferences = useUserPreferences();
	const [count, setCount] = useLocalStorage(
		`FitnessChartContainer-${props.title}`,
		10,
	);
	const userAnalytics = useGetUserAnalytics();

	const value = userAnalytics
		? props.children(count, userAnalytics)
		: undefined;

	return userPreferences.featuresEnabled.fitness.enabled ? (
		<Paper display="flex" h={380} withBorder={value?.totalItems === 0} p="md">
			<Flex flex={1} align="center" direction="column">
				<Group wrap="nowrap" w="100%" gap="xl" justify="center">
					<Text size="lg" fw="bold">
						{props.title}
					</Text>
					{props.disableCounter || (value?.totalItems || 0) === 0 ? null : (
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
