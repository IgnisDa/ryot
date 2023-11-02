import { LOCAL_STORAGE_KEYS } from "@/lib/constants";
import { useUserPreferences } from "@/lib/hooks";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Box,
	Text,
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
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useDisclosure, useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CreateUserMeasurementDocument,
	type CreateUserMeasurementMutationVariables,
	DeleteUserMeasurementDocument,
	type DeleteUserMeasurementMutationVariables,
	UserMeasurementsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase, startCase } from "@ryot/ts-utils";
import {
	IconChartArea,
	IconPlus,
	IconTable,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { get, set } from "lodash";
import { DateTime } from "luxon";
import Head from "next/head";
import { type ReactElement } from "react";
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
import type { NextPageWithLayout } from "../_app";
import { DataTable } from "mantine-datatable";

const dateFormatter = (date: Date) => {
	return DateTime.fromJSDate(date).toLocaleString(DateTime.DATETIME_SHORT);
};

enum TimeSpan {
	Last7Days = "Last 7 days",
	Last30Days = "Last 30 days",
	Last90Days = "Last 90 days",
	Last365Days = "Last 365 days",
	AllTime = "All Time",
}

const Page: NextPageWithLayout = () => {
	const [selectedStats, setselectedStats] = useLocalStorage<string[]>({
		defaultValue: [],
		key: LOCAL_STORAGE_KEYS.savedMeasurementsDisplaySelectedStats,
		getInitialValueInEffect: true,
	});
	const [selectedTimeSpan, setselectedTimespan] = useLocalStorage({
		defaultValue: TimeSpan.Last30Days,
		key: LOCAL_STORAGE_KEYS.savedMeasurementsDisplaySelectedTimespan,
		getInitialValueInEffect: true,
	});
	const [activeTab, setActiveTab] = useLocalStorage({
		defaultValue: "graph",
		key: LOCAL_STORAGE_KEYS.savedMeasurementsActiveTab,
		getInitialValueInEffect: true,
	});
	const [opened, { open, close }] = useDisclosure(false);
	const preferences = useUserPreferences();
	const userMeasurementsList = useQuery({
		queryKey: ["userMeasurementsList", selectedTimeSpan],
		queryFn: async () => {
			const now = DateTime.now();
			const [startTime, endTime] = match(selectedTimeSpan)
				.with(TimeSpan.Last7Days, () => [now, now.minus({ days: 7 })])
				.with(TimeSpan.Last30Days, () => [now, now.minus({ days: 30 })])
				.with(TimeSpan.Last90Days, () => [now, now.minus({ days: 90 })])
				.with(TimeSpan.Last365Days, () => [now, now.minus({ days: 365 })])
				.with(TimeSpan.AllTime, undefined, () => [null, null])
				.exhaustive();
			const { userMeasurementsList } = await gqlClient.request(
				UserMeasurementsListDocument,
				{
					input: {
						startTime: startTime?.toJSDate(),
						endTime: endTime?.toJSDate(),
					},
				},
			);
			return userMeasurementsList;
		},
	});

	const deleteUserMeasurement = useMutation({
		mutationFn: async (variables: DeleteUserMeasurementMutationVariables) => {
			const { deleteUserMeasurement } = await gqlClient.request(
				DeleteUserMeasurementDocument,
				variables,
			);
			return deleteUserMeasurement;
		},
		onSuccess: () => {
			userMeasurementsList.refetch();
		},
	});

	const createUserMeasurement = useMutation({
		mutationFn: async (variables: CreateUserMeasurementMutationVariables) => {
			const { createUserMeasurement } = await gqlClient.request(
				CreateUserMeasurementDocument,
				variables,
			);
			return createUserMeasurement;
		},
		onSuccess: () => {
			userMeasurementsList.refetch();
			notifications.show({
				title: "Success",
				message: "Added new measurement",
				color: "green",
			});
			close();
		},
	});

	return preferences.data ? (
		<>
			<Head>
				<title>Measurements | Ryot</title>
			</Head>
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
								{Object.keys(preferences.data.fitness.measurements.inbuilt)
									.filter((n) => n !== "custom")
									.filter(
										(n) =>
											// biome-ignore lint/suspicious/noExplicitAny: required
											(preferences as any).data.fitness.measurements.inbuilt[n],
									)
									.map((v) => (
										<NumberInput
											decimalScale={3}
											key={v}
											label={changeCase(snakeCase(v))}
											name={`stats.${v}`}
										/>
									))}
								{preferences.data.fitness.measurements.custom.map(
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
						<MultiSelect
							label="Statistics to display"
							data={[
								...Object.keys(preferences.data.fitness.measurements.inbuilt)
									.filter(
										(n) =>
											// biome-ignore lint/suspicious/noExplicitAny: required
											(preferences as any).data.fitness.measurements.inbuilt[n],
									)
									.map((v) => ({ name: v, value: v })),
								...preferences.data.fitness.measurements.custom.map(
									({ name }) => ({ name, value: `custom.${name}` }),
								),
							].map((v) => ({
								value: v.value,
								label: startCase(v.name),
							}))}
							value={selectedStats}
							onChange={(s) => {
								if (s) setselectedStats(s);
							}}
						/>
						<Select
							label="Timespan"
							value={selectedTimeSpan}
							data={Object.values(TimeSpan)}
							onChange={(v) => {
								if (v) setselectedTimespan(v as TimeSpan);
							}}
						/>
					</SimpleGrid>
					<Tabs
						value={activeTab}
						onChange={(v) => {
							if (v) setActiveTab(v);
						}}
						variant="outline"
					>
						<Tabs.List mb="xs">
							<Tabs.Tab value="graph" leftSection={<IconChartArea size={16} />}>
								Graph
							</Tabs.Tab>
							<Tabs.Tab value="table" leftSection={<IconTable size={16} />}>
								Table
							</Tabs.Tab>
						</Tabs.List>
						<Tabs.Panel value="graph">
							<Box w="100%" ml={-15}>
								{selectedStats ? (
									<ResponsiveContainer width="100%" height={300}>
										<LineChart
											data={userMeasurementsList.data}
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
								records={userMeasurementsList.data || []}
								columns={[
									{
										accessor: "timestamp",
										width: 200,
										render: ({ timestamp }) =>
											DateTime.fromJSDate(timestamp).toLocaleString(
												DateTime.DATETIME_SHORT,
											),
									},
									...([
										...Object.entries(
											preferences.data.fitness.measurements.inbuilt,
										)
											.map(([name, enabled]) =>
												enabled ? `stats.${name}` : undefined,
											)
											.filter(Boolean),
										...preferences.data.fitness.measurements.custom.map(
											(c) => `stats.custom.${c.name}`,
										),
									].map((w) => ({
										accessor: w,
										title: startCase(
											w
												?.replaceAll("stats", "")
												.replaceAll(".", "")
												.replaceAll("custom", ""),
										),
									})) as any),
									{
										accessor: "Delete",
										width: 80,
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
								{(userMeasurementsList.data || []).length} measurements
							</Text>
						</Tabs.Panel>
					</Tabs>
				</Stack>
			</Container>
		</>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
