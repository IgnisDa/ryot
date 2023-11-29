import {
	ActionIcon,
	Box,
	Button,
	Container,
	Drawer,
	Flex,
	MultiSelect,
	NumberInput,
	Select,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import "@mantine/dates/styles.css";
import { useDisclosure, useLocalStorage } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { UserMeasurementsListDocument } from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase, startCase } from "@ryot/ts-utils";
import {
	IconChartArea,
	IconPlus,
	IconTable,
	IconTrash,
} from "@tabler/icons-react";
import { get, set } from "lodash";
import { DateTime } from "luxon";
import { DataTable } from "mantine-datatable";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { LOCAL_STORAGE_KEYS } from "~/lib/constants";
import { getUserPreferences } from "~/lib/graphql.server";
import { useSearchParam } from "~/lib/hooks";

enum TimeSpan {
	Last7Days = "Last 7 days",
	Last30Days = "Last 30 days",
	Last90Days = "Last 90 days",
	Last365Days = "Last 365 days",
	AllTime = "All Time",
}

const searchParamsSchema = z.object({
	timeSpan: z.nativeEnum(TimeSpan).default(TimeSpan.Last30Days),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const now = DateTime.now();
	const [startTime, endTime] = match(query.timeSpan)
		.with(TimeSpan.Last7Days, () => [now, now.minus({ days: 7 })])
		.with(TimeSpan.Last30Days, () => [now, now.minus({ days: 30 })])
		.with(TimeSpan.Last90Days, () => [now, now.minus({ days: 90 })])
		.with(TimeSpan.Last365Days, () => [now, now.minus({ days: 365 })])
		.with(TimeSpan.AllTime, () => [null, null])
		.exhaustive();
	const [userPreferences, { userMeasurementsList }] = await Promise.all([
		getUserPreferences(request),
		gqlClient.request(
			UserMeasurementsListDocument,
			{ input: { startTime: startTime?.toISO(), endTime: endTime?.toISO() } },
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		query,
		userPreferences,
		userMeasurementsList,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Measurements | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [opened, { open, close }] = useDisclosure(false);
	const [selectedStats, setSelectedStats] = useLocalStorage({
		defaultValue: ["weight"],
		key: LOCAL_STORAGE_KEYS.savedMeasurementsDisplaySelectedStats,
		getInitialValueInEffect: true,
	});
	const [_, { setP }] = useSearchParam();

	return (
		<Container>
			<Drawer opened={opened} onClose={close} title="Add new measurement">
				<Box
					component="form"
					onSubmit={(e) => {
						e.preventDefault();
						const submitData = {};
						const formData = new FormData(e.currentTarget);
						for (const [name, value] of formData.entries())
							if (value !== "") set(submitData, name, value);
						if (Object.keys(submitData).length > 0) {
							createUserMeasurement.mutate({
								// biome-ignore lint/suspicious/noExplicitAny: required
								input: submitData as any,
							});
						}
					}}
				>
					<Stack>
						<DateTimePicker
							label="Timestamp"
							defaultValue={new Date()}
							name="timestamp"
							required
						/>
						<TextInput label="Name" name="name" />
						<SimpleGrid cols={2} style={{ alignItems: "end" }}>
							{Object.keys(
								loaderData.userPreferences.fitness.measurements.inbuilt,
							)
								.filter((n) => n !== "custom")
								.filter(
									(n) =>
										// biome-ignore lint/suspicious/noExplicitAny: required
										(loaderData.userPreferences as any).fitness.measurements
											.inbuilt[n],
								)
								.map((v) => (
									<NumberInput
										decimalScale={3}
										key={v}
										label={changeCase(snakeCase(v))}
										name={`stats.${v}`}
									/>
								))}
							{loaderData.userPreferences.fitness.measurements.custom.map(
								({ name }) => (
									<NumberInput
										key={name}
										label={changeCase(snakeCase(name))}
										name={`stats.custom.${name}`}
									/>
								),
							)}
						</SimpleGrid>
						<Textarea label="Comment" name="comment" />
						<Button type="submit">Submit</Button>
					</Stack>
				</Box>
			</Drawer>
			<Stack>
				<Flex align="center" gap="md">
					<Title>Measurements</Title>
					<ActionIcon color="green" variant="outline" onClick={open}>
						<IconPlus size={20} />
					</ActionIcon>
				</Flex>
				<SimpleGrid cols={{ base: 1, md: 2 }}>
					<Select
						label="Time span"
						defaultValue={loaderData.query.timeSpan}
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
									...Object.keys(
										loaderData.userPreferences.fitness.measurements.inbuilt,
									)
										.filter(
											(n) =>
												// biome-ignore lint/suspicious/noExplicitAny: required
												(loaderData.userPreferences as any).fitness.measurements
													.inbuilt[n],
										)
										.map((v) => ({ name: v, value: v })),
									...loaderData.userPreferences.fitness.measurements.custom.map(
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
								<ResponsiveContainer width="100%" height={300}>
									<LineChart
										data={loaderData.userMeasurementsList}
										margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
									>
										<CartesianGrid strokeDasharray="3 3" />
										<XAxis
											dataKey="timestamp"
											tickFormatter={dateFormatter}
											hide
										/>
										<YAxis domain={["dataMin - 1", "dataMax + 1"]} />
										<Tooltip />
										{selectedStats.map((s) => (
											<Line
												key={s}
												type="monotone"
												dot={false}
												dataKey={(v) => {
													const data = get(v.stats, s);
													if (data) return Number(data);
													return null;
												}}
												name={s}
												connectNulls
											/>
										))}
									</LineChart>
								</ResponsiveContainer>
							) : undefined}
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
									render: ({ timestamp }) =>
										DateTime.fromISO(timestamp).toLocaleString(
											DateTime.DATETIME_SHORT,
										),
								},
								...([
									...Object.entries(
										loaderData.userPreferences.fitness.measurements.inbuilt,
									)
										.map(([name, enabled]) =>
											enabled ? `stats.${name}` : undefined,
										)
										.filter(Boolean),
									...loaderData.userPreferences.fitness.measurements.custom.map(
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
										<ActionIcon
											color="red"
											onClick={() => {
												const yes = confirm(
													"This action can not be undone. Are you sure you want to delete this measurement?",
												);
												if (yes) deleteUserMeasurement.mutate({ timestamp });
											}}
										>
											<IconTrash />
										</ActionIcon>
									),
								},
							]}
						/>
						<Text ta="right" mt="xl" fw="bold">
							{loaderData.userMeasurementsList.length} measurements
						</Text>
					</Tabs.Panel>
				</Tabs>
			</Stack>
		</Container>
	);
}

const dateFormatter = (date: Date) => {
	return DateTime.fromJSDate(date).toLocaleString(DateTime.DATETIME_SHORT);
};
