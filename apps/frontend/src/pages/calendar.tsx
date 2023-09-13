import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Box,
	Button,
	Container,
	Group,
	Loader,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { UserCalendarEventsDocument } from "@ryot/generated/graphql/backend/graphql";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Head from "next/head";
import { type ReactElement } from "react";
import type { NextPageWithLayout } from "./_app";

const Page: NextPageWithLayout = () => {
	const coreDetails = useCoreDetails();
	const [selectedMonth, setMonth] = useLocalStorage({
		defaultValue: DateTime.now(),
		key: "savedCalendarDay",
		getInitialValueInEffect: false,
		serialize: (value) => {
			return value.toISO() as string;
		},
		deserialize: (value) => {
			return DateTime.fromISO(value);
		},
	});

	const calendarEvents = useQuery(
		["calendarEvents", selectedMonth],
		async () => {
			const { userCalendarEvents } = await gqlClient.request(
				UserCalendarEventsDocument,
				{ input: { month: selectedMonth.month, year: selectedMonth.year } },
			);
			return userCalendarEvents;
		},
		{ staleTime: Infinity },
	);

	return coreDetails.data && selectedMonth ? (
		<>
			<Head>
				<title>Calendar</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Group position="apart">
						<Title order={4}>{selectedMonth.toFormat("LLLL, yyyy")}</Title>
						<Button.Group>
							<ActionIcon
								variant="default"
								onClick={() => {
									const newMonth = selectedMonth.minus({ month: 1 });
									setMonth(newMonth);
								}}
							>
								<IconChevronLeft />
							</ActionIcon>
							<ActionIcon
								variant="default"
								onClick={() => {
									const newMonth = selectedMonth.plus({ month: 1 });
									setMonth(newMonth);
								}}
							>
								<IconChevronRight />
							</ActionIcon>
						</Button.Group>
					</Group>
					<Group position="center">
						{calendarEvents.data ? (
							<Box>
								{calendarEvents.data.events.map((ce) => (
									<Box
										key={ce.calendarEventId}
										data-calendar-event-id={ce.calendarEventId}
									>
										<Text>
											{ce.metadataTitle}: {ce.date}
										</Text>
									</Box>
								))}
							</Box>
						) : (
							<Loader size="lg" />
						)}
					</Group>
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
