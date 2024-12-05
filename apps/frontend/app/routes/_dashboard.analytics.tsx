import { BarChart, BubbleChart, PieChart } from "@mantine/charts";
import {
	Button,
	Container,
	Flex,
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
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import {
	type FitnessAnalytics,
	FitnessAnalyticsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, formatDateToNaiveDate, groupBy } from "@ryot/ts-utils";
import { IconCalendar, IconDeviceFloppy } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { produce } from "immer";
import { type ReactNode, useState } from "react";
import { match } from "ts-pattern";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import {
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

export default function Page() {
	const [customRangeOpened, setCustomRangeOpened] = useState(false);
	const { timeSpanSettings, setTimeSpanSettings } = useTimeSpanSettings();

	return (
		<>
			<CustomDateSelectModal
				opened={customRangeOpened}
				onClose={() => setCustomRangeOpened(false)}
			/>
			<Container>
				<Stack>
					<SimpleGrid cols={{ base: 2 }} style={{ alignItems: "center" }}>
						<Text fz={{ base: "lg", md: "h1" }} fw="bold">
							Analytics
						</Text>
						<Menu position="bottom-end">
							<Menu.Target>
								<Button
									w={{ md: 200 }}
									variant="default"
									ml={{ md: "auto" }}
									leftSection={<IconCalendar />}
								>
									{timeSpanSettings.range}
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
											if (range === "Custom") {
												setCustomRangeOpened(true);
												return;
											}
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
					</SimpleGrid>
					<SimpleGrid cols={{ base: 1, md: 2 }}>
						<MusclesChart />
						<ExercisesChart />
						<TimeOfDayChart />
					</SimpleGrid>
				</Stack>
			</Container>
		</>
	);
}

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
		<FitnessChartContainer title="Muscles worked out">
			{(data, count) => ({
				totalItems: data.workoutMuscles.length,
				render: (
					<PieChart
						size={250}
						withLabels
						withTooltip
						strokeWidth={0.5}
						labelsType="percent"
						tooltipDataSource="segment"
						data={data.workoutMuscles.slice(0, count).map((item) => ({
							value: item.count,
							name: changeCase(item.muscle),
							color: selectRandomElement(colors, item.muscle),
						}))}
					/>
				),
			})}
		</FitnessChartContainer>
	);
};

const ExercisesChart = () => {
	const colors = useGetMantineColors();

	return (
		<FitnessChartContainer title="Exercises done">
			{(data, count) => ({
				totalItems: data.workoutExercises.length,
				render: (
					<BarChart
						h={300}
						withTooltip
						dataKey="name"
						gridAxis="none"
						tickLine="none"
						tooltipAnimationDuration={500}
						series={[{ name: "value", label: "Times done" }]}
						data={data.workoutExercises.slice(0, count).map((item) => ({
							value: item.count,
							name: changeCase(item.exercise),
							color: selectRandomElement(colors, item.exercise),
						}))}
					/>
				),
			})}
		</FitnessChartContainer>
	);
};

const hourTuples = Array.from({ length: 8 }, (_, i) => [i * 3, i * 3 + 3]);

const formattedHour = (hour: number) =>
	dayjsLib().hour(hour).minute(0).format("ha");

const formattedHourLabel = (hour: string) => {
	const unGrouped = hour.split(",").map(Number);
	return `${formattedHour(unGrouped[0])}-${formattedHour(unGrouped[1])}`;
};

const TimeOfDayChart = () => {
	return (
		<FitnessChartContainer title="Time of day" disableCounter>
			{(data) => {
				const hours = Object.entries(
					groupBy(
						data.hours.map((h) => ({
							...h,
							hour: convertUtcHourToLocalHour(h.hour),
						})),
						(item) =>
							hourTuples.find(
								([start, end]) => item.hour >= start && item.hour < end,
							),
					),
				).map(([hour, values]) => ({
					index: 1,
					hour: formattedHourLabel(hour),
					count: values.reduce((acc, val) => acc + val.count, 0),
				}));
				return {
					totalItems: hours.length,
					render: (
						<BubbleChart
							h={60}
							mt="auto"
							color="lime"
							data={hours}
							range={[50, 300]}
							dataKey={{ x: "hour", y: "index", z: "count" }}
						/>
					),
				};
			}}
		</FitnessChartContainer>
	);
};

type FitnessChartContainerProps = {
	title: string;
	disableCounter?: boolean;
	children: (
		data: FitnessAnalytics,
		count: number,
	) => {
		render: ReactNode;
		totalItems: number;
	};
};

const FitnessChartContainer = (props: FitnessChartContainerProps) => {
	const userPreferences = useUserPreferences();
	const { startDate, endDate } = useTimeSpanSettings();
	const [count, setCount] = useLocalStorage(
		`FitnessChartContainer-${props.title}`,
		10,
	);
	const input = { startDate, endDate };

	const { data: fitnessAnalytics } = useQuery({
		queryKey: queryFactory.analytics.fitness({ input }).queryKey,
		queryFn: async () => {
			return await clientGqlService
				.request(FitnessAnalyticsDocument, { input })
				.then((data) => data.fitnessAnalytics);
		},
	});

	const value = fitnessAnalytics
		? props.children(fitnessAnalytics, count)
		: undefined;

	return userPreferences.featuresEnabled.fitness.enabled ? (
		<Paper
			p="xs"
			withBorder
			display="flex"
			h={props.disableCounter ? 140 : 380}
		>
			<Flex flex={1} align="center" direction="column">
				<Group wrap="nowrap" w="100%" gap="xl" justify="center">
					<Text size="lg">{props.title}</Text>
					{props.disableCounter ? null : (
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
