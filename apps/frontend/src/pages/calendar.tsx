import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Box, Container, Stack } from "@mantine/core";
import { MonthPicker } from "@mantine/dates";
import { useLocalStorage } from "@mantine/hooks";
import { UserCalendarEventsDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Head from "next/head";
import { type ReactElement } from "react";
import type { NextPageWithLayout } from "./_app";

const Page: NextPageWithLayout = () => {
	const coreDetails = useCoreDetails();
	const [dateRange, setDateRange] = useLocalStorage<[Date | null, Date | null]>(
		{
			defaultValue: [
				DateTime.now().minus({ months: 2 }).toJSDate(),
				new Date(),
			], // [end, start]
			key: "savedCalendarDate",
			getInitialValueInEffect: false,
		},
	);

	const calendarEvents = useQuery(["calendarEvents", dateRange], async () => {
		const { userCalendarEvents } = await gqlClient.request(
			UserCalendarEventsDocument,
			{
				input: {
					endTime: dateRange[0]
						? DateTime.fromJSDate(dateRange[0]).toISODate()
						: undefined,
					startTime: dateRange[1]
						? DateTime.fromJSDate(dateRange[1]).toISODate()
						: undefined,
				},
			},
		);
		return userCalendarEvents;
	});

	return coreDetails.data ? (
		<>
			<Head>
				<title>Calendar</title>
			</Head>
			<Container>
				<Stack>
					<MonthPicker
						size="xs"
						type="range"
						value={dateRange}
						onChange={setDateRange}
					/>
					<Box>{JSON.stringify(calendarEvents.data)}</Box>
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
