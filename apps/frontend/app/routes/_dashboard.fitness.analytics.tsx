import { BarChart, PieChart } from "@mantine/charts";
import {
	Button,
	Container,
	Flex,
	Group,
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
import { useLoaderData } from "@remix-run/react";
import { FitnessAnalyticsDocument } from "@ryot/generated/graphql/backend/graphql";
import { changeCase, formatDateToNaiveDate, groupBy } from "@ryot/ts-utils";
import { IconCalendar, IconDeviceFloppy } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { ClientOnly } from "remix-utils/client-only";
import { match } from "ts-pattern";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { zx } from "zodix";
import {
	convertUtcHourToLocalHour,
	dayjsLib,
	selectRandomElement,
} from "~/lib/generals";
import { useAppSearchParam, useGetMantineColors } from "~/lib/hooks";
import {
	getEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";

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

const searchParamsSchema = z.object({
	startDate: z.string().optional(),
	endDate: z.string().optional(),
	range: z.enum(TIME_RANGES).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const range = query.range ?? "Past 30 Days";
	const cookieName = await getEnhancedCookieName("fitness.analytics", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const startDate =
		query.startDate || formatDateToNaiveDate(getStartTime(range) || new Date());
	const endDate = query.endDate || formatDateToNaiveDate(dayjsLib());
	console.log(startDate, endDate);
	const { fitnessAnalytics } = await serverGqlService.authenticatedRequest(
		request,
		FitnessAnalyticsDocument,
		{ input: { startDate, endDate } },
	);
	return { range, startDate, endDate, cookieName, fitnessAnalytics };
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Fitness Analytics | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP, delP }] = useAppSearchParam(loaderData.cookieName);
	const [customRangeOpened, setCustomRangeOpened] = useState(false);

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
							Fitness Analytics
						</Text>
						<Menu position="bottom-end">
							<Menu.Target>
								<Button
									w={{ md: 200 }}
									variant="default"
									ml={{ md: "auto" }}
									leftSection={<IconCalendar />}
								>
									{loaderData.range}
								</Button>
							</Menu.Target>
							<Menu.Dropdown>
								{TIME_RANGES.map((range) => (
									<Menu.Item
										ta="right"
										key={range}
										onClick={() => {
											if (range === "Custom") {
												setCustomRangeOpened(true);
												return;
											}
											setP("range", range);
											delP("startDate");
											delP("endDate");
										}}
										color={loaderData.range === range ? "blue" : undefined}
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

const MusclesChart = () => {
	const loaderData = useLoaderData<typeof loader>();
	const colors = useGetMantineColors();
	const data = loaderData.fitnessAnalytics.workoutMuscles;
	const [count, setCount] = useLocalStorage(
		"FitnessAnalyticsMusclesChartCount",
		data.length > 7 ? 7 : data.length,
	);

	return (
		<ChartContainer
			totalItems={data.length}
			title="Muscles worked out"
			counter={{ count, setCount }}
		>
			<PieChart
				size={250}
				withLabels
				withTooltip
				strokeWidth={0.5}
				labelsType="percent"
				tooltipDataSource="segment"
				data={data.slice(0, count).map((item) => ({
					value: item.count,
					name: changeCase(item.muscle),
					color: selectRandomElement(colors, item.muscle),
				}))}
			/>
		</ChartContainer>
	);
};

const ExercisesChart = () => {
	const loaderData = useLoaderData<typeof loader>();
	const colors = useGetMantineColors();
	const data = loaderData.fitnessAnalytics.workoutExercises;
	const [count, setCount] = useLocalStorage(
		"FitnessAnalyticsExercisesChartCount",
		data.length > 7 ? 7 : data.length,
	);

	return (
		<ChartContainer
			title="Exercises done"
			totalItems={data.length}
			counter={{ count, setCount }}
		>
			<BarChart
				h={300}
				withTooltip
				dataKey="name"
				gridAxis="none"
				tickLine="none"
				tooltipAnimationDuration={500}
				series={[{ name: "value", label: "Times done" }]}
				data={data.slice(0, count).map((item) => ({
					value: item.count,
					name: changeCase(item.exercise),
					color: selectRandomElement(colors, item.exercise),
				}))}
			/>
		</ChartContainer>
	);
};

const hourTuples = Array.from({ length: 12 }, (_, i) => [i * 2, i * 2 + 1]);

const TimeOfDayChart = () => {
	const loaderData = useLoaderData<typeof loader>();
	const hours = Object.entries(
		groupBy(
			loaderData.fitnessAnalytics.hours.map((h) => ({
				...h,
				hour: convertUtcHourToLocalHour(h.hour),
			})),
			(item) =>
				hourTuples.find(
					([start, end]) => item.hour >= start && item.hour <= end,
				),
		),
	).map(([hour, values]) => {
		const grouped = hour.split(",").map(Number);
		return {
			hour: { from: grouped[0], to: grouped[1] + 1 },
			count: values.reduce((acc, val) => acc + val.count, 0),
		};
	});

	return (
		<ChartContainer
			counter={false}
			title="Time of day"
			totalItems={hours.length}
		>
			<div>{JSON.stringify(hours, null, 4)}</div>
		</ChartContainer>
	);
};

const ChartContainer = (props: {
	title: string;
	totalItems: number;
	children: ReactNode;
	counter:
		| {
				count: number;
				setCount: (count: number) => void;
		  }
		| false;
}) => {
	const counter = props.counter;

	return (
		<ClientOnly>
			{() => (
				<Paper withBorder p="xs" h={props.counter ? 380 : 140}>
					<Flex align="center" direction="column" gap={{ base: 4, md: "md" }}>
						<Group wrap="nowrap" w="100%" gap="xl" justify="center">
							<Text size="lg">{props.title}</Text>
							{counter ? (
								<NumberInput
									w={60}
									min={2}
									size="xs"
									value={counter.count}
									max={props.totalItems}
									onFocus={(e) => e.target.select()}
									onChange={(v) => counter.setCount(Number(v))}
								/>
							) : null}
						</Group>
						{props.totalItems > 0 ? (
							props.children
						) : (
							<Text fz="lg">No data found</Text>
						)}
					</Flex>
				</Paper>
			)}
		</ClientOnly>
	);
};

const CustomDateSelectModal = (props: {
	opened: boolean;
	onClose: () => void;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const [value, setValue] = useState<[Date | null, Date | null]>([
		new Date(loaderData.startDate),
		new Date(loaderData.endDate),
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
						setP("startDate", formatDateToNaiveDate(value[0] || new Date()));
						setP("endDate", formatDateToNaiveDate(value[1] || new Date()));
						setP("range", TIME_RANGES[8]);
						props.onClose();
					}}
				>
					Apply
				</Button>
			</Stack>
		</Modal>
	);
};
