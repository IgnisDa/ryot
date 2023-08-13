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
	MultiSelect,
	NumberInput,
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

const dateFormatter = (date: Date) => {
	return DateTime.fromJSDate(date).toLocaleString(DateTime.DATETIME_SHORT);
};

const Page: NextPageWithLayout = () => {
	const [selectedStats, setselectedStates] = useLocalStorage<string[]>({
		defaultValue: [],
		key: "measurementsDisplaySelectedStats",
		getInitialValueInEffect: true,
	});
	const [opened, { open, close }] = useDisclosure(false);

	const preferences = useUserPreferences();
	const userMeasurementsList = useQuery(["userMeasurementsList"], async () => {
		const { userMeasurementsList } = await gqlClient.request(
			UserMeasurementsListDocument,
		);
		return userMeasurementsList;
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
					<MultiSelect
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
						defaultValue={selectedStats}
						onChange={(s) => {
							if (s) setselectedStates(s);
						}}
					/>
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
