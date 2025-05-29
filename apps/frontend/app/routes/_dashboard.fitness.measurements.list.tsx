import { LineChart } from "@mantine/charts";
import {
	ActionIcon,
	Box,
	Container,
	Flex,
	MultiSelect,
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
} from "@ryot/generated/graphql/backend/graphql";
import {
	getActionIntent,
	parseSearchQuery,
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
import { DataTable } from "mantine-datatable";
import { Form, useLoaderData } from "react-router";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import {
	TimeSpan,
	convertEnumToSelectData,
	dayjsLib,
	generateColor,
	getDateFromTimeSpan,
	getStringAsciiValue,
	openConfirmationModal,
} from "~/lib/common";
import {
	useAppSearchParam,
	useConfirmSubmit,
	useUserPreferences,
} from "~/lib/hooks";
import { useMeasurementsDrawerOpen } from "~/lib/state/fitness";
import {
	createToastHeaders,
	getSearchEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.fitness.measurements.list";

const searchParamsSchema = z.object({
	timeSpan: z.nativeEnum(TimeSpan).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

const defaultTimeSpan = TimeSpan.Last30Days;

export const loader = async ({ request }: Route.LoaderArgs) => {
	const cookieName = await getSearchEnhancedCookieName(
		"measurements.list",
		request,
	);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = parseSearchQuery(request, searchParamsSchema);
	const now = dayjsLib();
	const startTime = getDateFromTimeSpan(query.timeSpan || defaultTimeSpan);
	const [{ userMeasurementsList }] = await Promise.all([
		serverGqlService.authenticatedRequest(
			request,
			UserMeasurementsListDocument,
			{
				input: {
					endTime: now.toISOString(),
					startTime: startTime?.toISOString(),
				},
			},
		),
	]);
	return { query, userMeasurementsList, cookieName };
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
			return Response.json({ status: "success", submission } as const, {
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
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const submit = useConfirmSubmit();
	const selectedStatistics =
		userPreferences.fitness.measurements.statistics.map((v) => ({
			value: v.name,
			label: `${startCase(v.name)} ${v.unit ? `(${v.unit})` : ""}`,
		}));
	const formattedData = loaderData.userMeasurementsList.response.map((m) => {
		const local: Record<string, string> = {
			timestamp: m.timestamp,
			formattedTimestamp: tickFormatter(m.timestamp),
		};
		for (const s of m.information.statistics) local[s.name] = s.value;
		return local;
	});
	const [selectedStats, setSelectedStats] = useLocalStorage(
		"SavedMeasurementsDisplaySelectedStats",
		["weight"],
	);
	const [_p, { setP }] = useAppSearchParam(loaderData.cookieName);
	const [_m, setMeasurementsDrawerOpen] = useMeasurementsDrawerOpen();

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
						defaultValue={loaderData.query.timeSpan || defaultTimeSpan}
						onChange={(v) => {
							if (v) setP("timeSpan", v);
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
						<SimpleGrid cols={{ base: 1, md: 2 }}>
							<MultiSelect
								value={selectedStats}
								data={selectedStatistics}
								label="Statistics to display"
								onChange={(s) => {
									if (s) setSelectedStats(s);
								}}
							/>
						</SimpleGrid>
						<Box w="100%" ml={-15} mt="md">
							{selectedStats ? (
								<LineChart
									h={300}
									connectNulls
									curveType="monotone"
									data={formattedData}
									dataKey="formattedTimestamp"
									series={selectedStats.map((name) => ({
										name,
										color: generateColor(getStringAsciiValue(name)),
									}))}
								/>
							) : null}
						</Box>
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
					{loaderData.userMeasurementsList.response.length} data points
				</Text>
			</Stack>
		</Container>
	);
}

const tickFormatter = (date: string) => dayjsLib(date).format("L");
