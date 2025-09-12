import { LineChart } from "@mantine/charts";
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
import {
	DeleteUserMeasurementDocument,
	UserMeasurementsListDocument,
	type UserMeasurementsListInput,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getActionIntent,
	processSubmission,
	reverse,
	startCase,
} from "@ryot/ts-utils";
import {
	IconChartArea,
	IconPlus,
	IconTable,
	IconTrash,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "mantine-datatable";
import { useMemo } from "react";
import { Form, data } from "react-router";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { dayjsLib, getDateFromTimeSpan } from "~/lib/shared/date-utils";
import { useConfirmSubmit, useUserPreferences } from "~/lib/shared/hooks";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";
import {
	convertEnumToSelectData,
	generateColor,
	getStringAsciiValue,
	openConfirmationModal,
} from "~/lib/shared/ui-utils";
import { useMeasurementsDrawerOpen } from "~/lib/state/fitness";
import { TimeSpan } from "~/lib/types";
import { createToastHeaders, serverGqlService } from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.fitness.measurements.list";

interface FilterState {
	timeSpan: TimeSpan;
}

const defaultFilterState: FilterState = {
	timeSpan: TimeSpan.Last30Days,
};

export const meta = () => {
	return [{ title: "Measurements | Ryot" }];
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("delete", async () => {
			const submission = processSubmission(formData, deleteSchema);
			await serverGqlService.authenticatedRequest(
				request,
				DeleteUserMeasurementDocument,
				submission,
			);
			return data({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Measurement deleted successfully",
				}),
			});
		})
		.run();
};

const deleteSchema = z.object({ timestamp: z.string() });

export default function Page() {
	const submit = useConfirmSubmit();
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

	const { data: userMeasurementsList } = useQuery({
		queryKey: queryFactory.fitness.userMeasurementsList(input).queryKey,
		queryFn: () =>
			clientGqlService
				.request(UserMeasurementsListDocument, { input })
				.then((data) => data.userMeasurementsList),
	});

	const selectedStatistics =
		userPreferences.fitness.measurements.statistics.map((v) => ({
			value: v.name,
			label: `${startCase(v.name)} ${v.unit ? `(${v.unit})` : ""}`,
		}));

	const formattedData =
		userMeasurementsList?.response?.map((m) => {
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
						<SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mt="md">
							{selectedStatistics.map((stat) => (
								<StatChart
									stat={stat}
									key={stat.value}
									formattedData={formattedData}
								/>
							))}
						</SimpleGrid>
					</Tabs.Panel>
					<Tabs.Panel value="table">
						<DataTable
							height={400}
							borderRadius="sm"
							withColumnBorders
							withTableBorder={false}
							records={reverse(formattedData)}
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
										<Form
											method="POST"
											action={withQuery(".", { intent: "delete" })}
										>
											<input
												type="hidden"
												name="timestamp"
												defaultValue={timestamp}
											/>
											<ActionIcon
												color="red"
												type="submit"
												onClick={(e) => {
													const form = e.currentTarget.form;
													e.preventDefault();
													openConfirmationModal(
														"This action can not be undone. Are you sure you want to delete this measurement?",
														() => submit(form),
													);
												}}
											>
												<IconTrash />
											</ActionIcon>
										</Form>
									),
								},
							]}
						/>
					</Tabs.Panel>
				</Tabs>
				<Text ta="right" mt="xl" fw="bold">
					{userMeasurementsList?.response?.length || 0} data points
				</Text>
			</Stack>
		</Container>
	);
}

const tickFormatter = (date: string) => dayjsLib(date).format("L");

interface StatChartProps {
	stat: { value: string; label: string };
	formattedData: Array<Record<string, string>>;
}

const StatChart = (props: StatChartProps) => {
	return (
		<Stack gap="xs">
			<Text fw={500} ta="center">
				{props.stat.label}
			</Text>
			<Box w="100%" ml={-15}>
				<LineChart
					h={250}
					connectNulls
					curveType="monotone"
					data={props.formattedData}
					dataKey="formattedTimestamp"
					series={[
						{
							name: props.stat.value,
							color: generateColor(getStringAsciiValue(props.stat.value)),
						},
					]}
				/>
			</Box>
		</Stack>
	);
};
