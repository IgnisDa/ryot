import type { NextPageWithLayout } from "../_app";
import { useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Box,
	Button,
	Container,
	Drawer,
	Flex,
	Group,
	MultiSelect,
	NumberInput,
	Paper,
	ScrollArea,
	Select,
	SimpleGrid,
	Stack,
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
	type UserMeasurement,
	UserMeasurementsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase, startCase } from "@ryot/ts-utils";
import { IconPlus } from "@tabler/icons-react";
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

const getValues = (m: UserMeasurement["stats"]) => {
	const vals: { name: string; value: string }[] = [];
	for (const [key, val] of Object.entries(m)) {
		if (key !== "custom") {
			if (val !== null) {
				vals.push({ name: key, value: val });
			}
		} else {
			for (const [keyC, valC] of Object.entries(m.custom || {}))
				vals.push({ name: keyC, value: valC as any });
		}
	}
	return vals;
};

const DisplayMeasurement = (props: { measurement: UserMeasurement }) => {
	const values = getValues(props.measurement.stats);
	return (
		<Paper key={props.measurement.timestamp.toISOString()} withBorder p="xs">
			{JSON.stringify(values)}
		</Paper>
	);
};

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
		key: "measurementsDisplaySelectedStats",
		getInitialValueInEffect: true,
	});
	const [selectedTimespan, setselectedTimespan] = useLocalStorage({
		defaultValue: TimeSpan.Last30Days,
		key: "measurementsDisplaySelectedTimespan",
		getInitialValueInEffect: true,
	});
	const [opened, { open, close }] = useDisclosure(false);

	const preferences = useUserPreferences();
	const userMeasurementsList = useQuery(
		["userMeasurementsList", selectedTimespan],
		async () => {
			const now = DateTime.now();
			const [startTime, endTime] = match(selectedTimespan)
				.with(TimeSpan.Last7Days, () => [now, now.minus({ days: 7 })])
				.with(TimeSpan.Last30Days, () => [now, now.minus({ days: 30 })])
				.with(TimeSpan.Last90Days, () => [now, now.minus({ days: 90 })])
				.with(TimeSpan.Last365Days, () => [now, now.minus({ days: 365 })])
				.with(TimeSpan.AllTime, () => [null, null])
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
	);
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

	return userMeasurementsList.data && preferences.data ? (
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
							for (const [name, value] of formData.entries()) {
								if (value !== "") set(submitData, name, value);
							}
							if (Object.keys(submitData).length > 0) {
								createUserMeasurement.mutate({
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
											(preferences as any).data.fitness.measurements.inbuilt[n],
									)
									.map((v) => (
										<NumberInput
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
					<Flex align={"center"} gap={"md"}>
						<Title>Measurements</Title>
						<ActionIcon color="green" variant="outline" onClick={open}>
							<IconPlus size="1.25rem" />
						</ActionIcon>
					</Flex>
					<Group grow>
						<MultiSelect
							label="Statistics to display"
							data={[
								...Object.keys(preferences.data.fitness.measurements.inbuilt)
									.filter(
										(n) =>
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
							value={selectedTimespan}
							data={Object.values(TimeSpan)}
							onChange={(v) => {
								if (v) setselectedTimespan(v as TimeSpan);
							}}
						/>
					</Group>
					<Box w={"100%"} ml={-15}>
						<ResponsiveContainer width="100%" height={300}>
							<LineChart
								data={userMeasurementsList.data}
								margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
							>
								<CartesianGrid strokeDasharray="3 3" />
								<XAxis dataKey="timestamp" tickFormatter={dateFormatter} hide />
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
					</Box>
					<ScrollArea h={400}>
						{userMeasurementsList.data.map((m, idx) => (
							<DisplayMeasurement key={idx} measurement={m} />
						))}
					</ScrollArea>
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
