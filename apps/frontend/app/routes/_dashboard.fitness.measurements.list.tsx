import { LineChart } from "@mantine/charts";
import "@mantine/charts/styles.css";
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
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	CreateUserMeasurementDocument,
	DeleteUserMeasurementDocument,
	UserMeasurementsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase, startCase } from "@ryot/ts-utils";
import {
	IconChartArea,
	IconPlus,
	IconTable,
	IconTrash,
} from "@tabler/icons-react";
import set from "lodash/set";
import { DataTable } from "mantine-datatable";
import { namedAction } from "remix-utils/named-action";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { LOCAL_STORAGE_KEYS, dayjsLib } from "~/lib/generals";
import { getUserPreferences } from "~/lib/graphql.server";
import { useSearchParam } from "~/lib/hooks";
import { createToastHeaders } from "~/lib/toast.server";
import { processSubmission } from "~/lib/utilities.server";

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
	const now = dayjsLib();
	const [startTime, endTime] = match(query.timeSpan)
		.with(TimeSpan.Last7Days, () => [now, now.subtract(7, "days")])
		.with(TimeSpan.Last30Days, () => [now, now.subtract(30, "days")])
		.with(TimeSpan.Last90Days, () => [now, now.subtract(90, "days")])
		.with(TimeSpan.Last365Days, () => [now, now.subtract(365, "days")])
		.with(TimeSpan.AllTime, () => [null, null])
		.exhaustive();
	const [userPreferences, { userMeasurementsList }] = await Promise.all([
		getUserPreferences(request),
		gqlClient.request(
			UserMeasurementsListDocument,
			{
				input: {
					startTime: startTime?.toISOString(),
					endTime: endTime?.toISOString(),
				},
			},
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		query,
		userPreferences: { fitness: userPreferences.fitness },
		userMeasurementsList,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Measurements | Ryot" }];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return namedAction(request, {
		create: async () => {
			// biome-ignore lint/suspicious/noExplicitAny: the form values ensure that the submission is valid
			const submission: any = {};
			for (const [name, value] of formData.entries())
				if (value !== "") set(submission, name, value);
			await gqlClient.request(
				CreateUserMeasurementDocument,
				{ input: submission },
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Measurement submitted successfully",
				}),
			});
		},
		delete: async () => {
			const submission = processSubmission(formData, deleteSchema);
			await gqlClient.request(
				DeleteUserMeasurementDocument,
				submission,
				await getAuthorizationHeader(request),
			);
			return json({ status: "success", submission } as const, {
				headers: await createToastHeaders({
					message: "Measurement deleted successfully",
				}),
			});
		},
	});
};

const deleteSchema = z.object({ timestamp: z.string() });

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
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
				<Box component={Form} method="post" action="?intent=create">
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
										loaderData.userPreferences.fitness.measurements.inbuilt,
									)
										.map(([name, enabled]) =>
											enabled ? `stats.${name}` : null,
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
										<Form action="?intent=delete" method="post">
											<ActionIcon
												color="red"
												onClick={(e) => {
													if (
														!confirm(
															"This action can not be undone. Are you sure you want to delete this measurement?",
														)
													)
														e.preventDefault();
												}}
												type="submit"
												value={timestamp}
												name="timestamp"
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
