import { CompositeChart } from "@mantine/charts";
import {
	ActionIcon,
	Box,
	Container,
	Flex,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	DeleteUserMeasurementDocument,
	UserMeasurementsListDocument,
	type UserMeasurementsListInput,
} from "@ryot/generated/graphql/backend/graphql";
import { cloneDeep, reverse, startCase } from "@ryot/ts-utils";
import {
	IconChartArea,
	IconPlus,
	IconTable,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DataTable } from "mantine-datatable";
import { useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import { dayjsLib, getDateFromTimeSpan } from "~/lib/shared/date-utils";
import { useUserPreferences } from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import {
	convertEnumToSelectData,
	generateColor,
	getStringAsciiValue,
	openConfirmationModal,
} from "~/lib/shared/ui-utils";
import { useMeasurementsDrawerOpen } from "~/lib/state/fitness";
import { TimeSpan } from "~/lib/types";

interface FilterState {
	timeSpan: TimeSpan;
}

const defaultFilterState: FilterState = {
	timeSpan: TimeSpan.Last30Days,
};

export const meta = () => {
	return [{ title: "Measurements | Ryot" }];
};

export default function Page() {
	const userPreferences = useUserPreferences();
	const [, setMeasurementsDrawerOpen] = useMeasurementsDrawerOpen();
	const [filters, setFilters] = useLocalStorage(
		"MeasurementsListFilters",
		defaultFilterState,
	);

	const input: UserMeasurementsListInput = useMemo(() => {
		const now = dayjsLib();
		const startTime = getDateFromTimeSpan(filters.timeSpan);
		return { endTime: now.toISOString(), startTime: startTime?.toISOString() };
	}, [filters.timeSpan]);

	const { data: userMeasurementsList, refetch } = useQuery({
		queryKey: queryFactory.fitness.userMeasurementsList(input).queryKey,
		queryFn: () =>
			clientGqlService
				.request(UserMeasurementsListDocument, { input })
				.then((data) => data.userMeasurementsList.response),
	});

	const deleteUserMeasurementMutation = useMutation({
		mutationFn: (timestamp: string) =>
			clientGqlService.request(DeleteUserMeasurementDocument, {
				timestamp,
			}),
		onSuccess: () => {
			notifications.show({
				color: "green",
				title: "Success",
				message: "Measurement deleted successfully",
			});
			refetch();
		},
		onError: () => {
			notifications.show({
				color: "red",
				title: "Error",
				message: "Failed to delete measurement",
			});
		},
	});

	const selectedStatistics =
		userPreferences.fitness.measurements.statistics.map((v) => ({
			value: v.name,
			label: `${startCase(v.name)} ${v.unit ? `(${v.unit})` : ""}`,
		}));

	const formattedData =
		userMeasurementsList?.map((m) => {
			const local: Record<string, string> = {
				timestamp: m.timestamp,
				formattedTimestamp: tickFormatter(m.timestamp),
			};
			for (const s of m.information.statistics) local[s.name] = s.value;
			return local;
		}) || [];

	const updateFilter = (key: keyof FilterState, value: TimeSpan) =>
		setFilters((prev) => ({ ...prev, [key]: value }));

	return (
		<Container>
			<Stack>
				<Flex align="center" gap="md">
					<Title>Measurements</Title>
					<ActionIcon
						color="green"
						variant="outline"
						onClick={() => setMeasurementsDrawerOpen(true)}
					>
						<IconPlus size={20} />
					</ActionIcon>
				</Flex>
				<SimpleGrid cols={{ base: 1, md: 2 }}>
					<Select
						label="Time span"
						data={convertEnumToSelectData(TimeSpan)}
						value={filters.timeSpan}
						onChange={(v) => {
							if (v) updateFilter("timeSpan", v as TimeSpan);
						}}
					/>
				</SimpleGrid>
				<Tabs defaultValue="graph" variant="outline">
					<Tabs.List mb="xs">
						<Tabs.Tab value="graph" leftSection={<IconChartArea size={16} />}>
							Graph
						</Tabs.Tab>
						<Tabs.Tab value="table" leftSection={<IconTable size={16} />}>
							Table
						</Tabs.Tab>
					</Tabs.List>
					<Tabs.Panel value="graph">
						<Stack gap="md" mt="md">
							{selectedStatistics.map((stat) => (
								<SyncedMeasurementChart
									stat={stat}
									key={stat.value}
									formattedData={formattedData}
								/>
							))}
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="table">
						<DataTable
							height={400}
							borderRadius="sm"
							withColumnBorders
							withTableBorder={false}
							records={reverse(cloneDeep(formattedData))}
							columns={[
								{
									width: 200,
									accessor: "timestamp",
									render: ({ timestamp }) => dayjsLib(timestamp).format("lll"),
								},
								...selectedStatistics.map((s) => ({
									title: s.label,
									accessor: s.value,
								})),
								{
									width: 80,
									accessor: "Delete",
									textAlign: "center",
									render: ({ timestamp }) => (
										<ActionIcon
											color="red"
											loading={deleteUserMeasurementMutation.isPending}
											onClick={() => {
												openConfirmationModal(
													"This action can not be undone. Are you sure you want to delete this measurement?",
													() => deleteUserMeasurementMutation.mutate(timestamp),
												);
											}}
										>
											<IconTrash />
										</ActionIcon>
									),
								},
							]}
						/>
					</Tabs.Panel>
				</Tabs>
				<Text ta="right" mt="xl" fw="bold">
					{userMeasurementsList?.length || 0} data points
				</Text>
			</Stack>
		</Container>
	);
}

const tickFormatter = (date: string) => dayjsLib(date).format("L");

type Data = Array<Record<string, string>>;

const calculateYAxisDomain = (data: Data, statValue: string) => {
	const values = data
		.map((item) => Number.parseFloat(item[statValue]))
		.filter((val) => !Number.isFinite(val));

	if (values.length === 0) return [0, 100];

	const minValue = Math.min(...values);
	const maxValue = Math.max(...values);

	if (minValue === maxValue) {
		const padding = Math.abs(minValue) * 0.1 || 10;
		return [minValue - padding, maxValue + padding];
	}

	const range = maxValue - minValue;
	const padding = range * 0.1;

	return [minValue - padding, maxValue + padding];
};

interface SyncedMeasurementChartProps {
	formattedData: Data;
	stat: { value: string; label: string };
}

const SyncedMeasurementChart = (props: SyncedMeasurementChartProps) => {
	const yAxisDomain = useMemo(
		() => calculateYAxisDomain(props.formattedData, props.stat.value),
		[props.formattedData, props.stat.value],
	);

	return (
		<Stack gap="xs">
			<Text fw="bold" ta="center">
				{props.stat.label}
			</Text>
			<Box w="100%" ml={-15}>
				<CompositeChart
					h={250}
					data={props.formattedData}
					dataKey="formattedTimestamp"
					yAxisProps={{ domain: yAxisDomain }}
					composedChartProps={{ syncId: "measurements" }}
					valueFormatter={(val) => Number(val).toFixed(2)}
					series={[
						{
							name: props.stat.value,
							type: "line",
							color: generateColor(getStringAsciiValue(props.stat.value)),
						},
					]}
				/>
			</Box>
		</Stack>
	);
};
