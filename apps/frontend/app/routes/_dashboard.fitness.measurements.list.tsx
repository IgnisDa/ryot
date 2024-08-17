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
import { useLocalStorage } from "@mantine/hooks";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import {
	Form,
	type MetaArgs_SingleFetch,
	useLoaderData,
} from "@remix-run/react";
import {
	DeleteUserMeasurementDocument,
	UserMeasurementsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { processSubmission, startCase } from "@ryot/ts-utils";
import {
	IconChartArea,
	IconPlus,
	IconTable,
	IconTrash,
} from "@tabler/icons-react";
import { DataTable } from "mantine-datatable";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { confirmWrapper } from "~/components/confirmation";
import { dayjsLib } from "~/lib/generals";
import {
	useAppSearchParam,
	useConfirmSubmit,
	useUserPreferences,
} from "~/lib/hooks";
import { useMeasurementsDrawerOpen } from "~/lib/state/fitness";
import {
	createToastHeaders,
	getEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";

enum TimeSpan {
	Last7Days = "Last 7 days",
	Last30Days = "Last 30 days",
	Last90Days = "Last 90 days",
	Last365Days = "Last 365 days",
	AllTime = "All Time",
}

const searchParamsSchema = z.object({
	timeSpan: z.nativeEnum(TimeSpan).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

const defaultTimeSpan = TimeSpan.Last30Days;

export const loader = unstable_defineLoader(async ({ request }) => {
	const cookieName = await getEnhancedCookieName("measurements.list", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = zx.parseQuery(request, searchParamsSchema);
	const now = dayjsLib();
	const [startTime, endTime] = match(query.timeSpan || defaultTimeSpan)
		.with(TimeSpan.Last7Days, () => [now, now.subtract(7, "days")])
		.with(TimeSpan.Last30Days, () => [now, now.subtract(30, "days")])
		.with(TimeSpan.Last90Days, () => [now, now.subtract(90, "days")])
		.with(TimeSpan.Last365Days, () => [now, now.subtract(365, "days")])
		.with(TimeSpan.AllTime, () => [null, null])
		.exhaustive();
	const [{ userMeasurementsList }] = await Promise.all([
		serverGqlService.authenticatedRequest(
			request,
			UserMeasurementsListDocument,
			{
				input: {
					startTime: startTime?.toISOString(),
					endTime: endTime?.toISOString(),
				},
			},
		),
	]);
	return { query, userMeasurementsList, cookieName };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Measurements | Ryot" }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		delete: async () => {
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
		},
	});
});

const deleteSchema = z.object({ timestamp: z.string() });

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const submit = useConfirmSubmit();
	const formattedData = loaderData.userMeasurementsList.map((m) => {
		const customStats = Object.fromEntries(
			Object.entries(m.stats.custom || {})
				.filter(([, v]) => v)
				.map(([k, v]) => [`custom.${k}`, v]),
		);
		const inbuiltStats = Object.fromEntries(
			Object.entries(m.stats).filter(([k, v]) => k !== "custom" && v),
		);
		return {
			...inbuiltStats,
			...customStats,
			timestamp: tickFormatter(m.timestamp),
		};
	});
	const [selectedStats, setSelectedStats] = useLocalStorage({
		defaultValue: ["weight"],
		key: "SavedMeasurementsDisplaySelectedStats",
		getInitialValueInEffect: true,
	});
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
						defaultValue={loaderData.query.timeSpan || defaultTimeSpan}
						data={Object.values(TimeSpan)}
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
								label="Statistics to display"
								data={[
									...Object.keys(userPreferences.fitness.measurements.inbuilt)
										.filter(
											(n) =>
												// biome-ignore lint/suspicious/noExplicitAny: required
												(userPreferences as any).fitness.measurements.inbuilt[
													n
												],
										)
										.map((v) => ({ name: v, value: v })),
									...userPreferences.fitness.measurements.custom.map(
										({ name }) => ({ name, value: `custom.${name}` }),
									),
								].map((v) => ({
									value: v.value,
									label: startCase(v.name),
								}))}
								value={selectedStats}
								onChange={(s) => {
									if (s) setSelectedStats(s);
								}}
							/>
						</SimpleGrid>
						<Box w="100%" ml={-15} mt="md">
							{selectedStats ? (
								<LineChart
									h={300}
									series={selectedStats.map((s) => ({
										name: s,
										color: "blue",
									}))}
									data={formattedData}
									dataKey="timestamp"
									curveType="monotone"
									connectNulls
								/>
							) : null}
						</Box>
					</Tabs.Panel>
					<Tabs.Panel value="table">
						<DataTable
							height={400}
							withTableBorder={false}
							borderRadius="sm"
							withColumnBorders
							records={loaderData.userMeasurementsList}
							columns={[
								{
									accessor: "timestamp",
									width: 200,
									render: ({ timestamp }) => dayjsLib(timestamp).format("lll"),
								},
								...([
									...Object.entries(
										userPreferences.fitness.measurements.inbuilt,
									)
										.map(([name, enabled]) =>
											enabled ? `stats.${name}` : null,
										)
										.filter(Boolean),
									...userPreferences.fitness.measurements.custom.map(
										(c) => `stats.custom.${c.name}`,
									),
								].map((w) => ({
									accessor: w,
									textAlign: "center",
									title: startCase(
										w
											?.replaceAll("stats", "")
											.replaceAll(".", "")
											.replaceAll("custom", ""),
									),
									// biome-ignore lint/suspicious/noExplicitAny: required here
								})) as any),
								{
									accessor: "Delete",
									width: 80,
									textAlign: "center",
									render: ({ timestamp }) => (
										<Form method="POST" replace>
											<input
												type="hidden"
												name="intent"
												defaultValue="delete"
											/>
											<input
												type="hidden"
												name="timestamp"
												defaultValue={timestamp}
											/>
											<ActionIcon
												color="red"
												type="submit"
												onClick={async (e) => {
													const form = e.currentTarget.form;
													e.preventDefault();
													const conf = await confirmWrapper({
														confirmation:
															"This action can not be undone. Are you sure you want to delete this measurement?",
													});
													if (conf && form) submit(form);
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
					{loaderData.userMeasurementsList.length} data points
				</Text>
			</Stack>
		</Container>
	);
}

const tickFormatter = (date: string) => dayjsLib(date).format("L");
