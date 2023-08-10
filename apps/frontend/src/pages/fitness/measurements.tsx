import type { NextPageWithLayout } from "../_app";
import { useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Box, Container, Select, Stack, Title } from "@mantine/core";
import { UserMeasurementsListDocument } from "@ryot/generated/graphql/backend/graphql";
import { startCase } from "@ryot/ts-utils";
import { useQuery } from "@tanstack/react-query";
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

	const preferences = useUserPreferences();
	const userMeasurementsList = useQuery(["userMeasurementsList"], async () => {
		const { userMeasurementsList } = await gqlClient.request(
			UserMeasurementsListDocument,
		);
		return userMeasurementsList;
	});

	return userMeasurementsList.data && preferences.data ? (
		<>
			<Head>
				<title>Measurements | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Title>Measurements</Title>
					<Select
						data={[
							...Object.keys(preferences.data.fitness.measurements.inbuilt),
							...preferences.data.fitness.measurements.custom.map(c => c.name),
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
