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
	NumberInput,
	Select,
	SimpleGrid,
	Stack,
	TextInput,
	Text,
	Textarea,
	Title,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CreateUserMeasurementDocument,
	type CreateUserMeasurementMutationVariables,
	UserMeasurementsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase, startCase } from "@ryot/ts-utils";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { set } from "lodash";
import { DateTime } from "luxon";
import Head from "next/head";
import { type ReactElement, useState } from "react";
import {
	CartesianGrid,
	Legend,
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
	const [stat, setState] = useState("weight");
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
						<ActionIcon
							color="green"
							variant="outline"
							onClick={() => {
								open();
							}}
						>
							<IconPlus size="1.25rem" />
						</ActionIcon>
					</Flex>
					<Text>Displaying measurements is still WIP.</Text>
					<Select
						data={[
							...Object.keys(preferences.data.fitness.measurements.inbuilt),
							...preferences.data.fitness.measurements.custom.map(
								(c) => c.name,
							),
						].map((v) => ({
							value: v,
							label: startCase(v),
						}))}
						defaultValue={stat}
						onChange={(s) => {
							if (s) setState(s);
						}}
					/>
					<Box w={300}>
						<ResponsiveContainer width="100%" height={300}>
							<LineChart
								data={userMeasurementsList.data}
								margin={{
									top: 0,
									right: 0,
									left: 0,
									bottom: 0,
								}}
							>
								<CartesianGrid strokeDasharray="3 3" />
								<XAxis dataKey="timestamp" tickFormatter={dateFormatter} />
								<YAxis />
								<Tooltip />
								<Legend />
								<Line
									type="monotone"
									dataKey={(s) =>
										typeof s.stats[stat] === "string"
											? Number(s.stats[stat])
											: null
									}
									name={stat}
									connectNulls
								/>
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
