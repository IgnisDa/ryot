import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Box,
	Button,
	Card,
	Container,
	Group,
	Loader,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import {
	UserCalendarEventsDocument,
	type UserCalendarEventsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Head from "next/head";
import { type ReactElement } from "react";
import type { NextPageWithLayout } from "./_app";

const CalendarEvent = (props: {
	day: UserCalendarEventsQuery["userCalendarEvents"][number];
}) => {
	const date = DateTime.fromISO(props.day.date);

	return (
		<Card
			data-calendar-date={props.day.date}
			withBorder
			radius={"sm"}
			padding={"xs"}
			mt="sm"
		>
			<Card.Section withBorder p="sm">
				<Group position="apart">
					<Text>{date.toFormat("d LLLL")}</Text>
					<Text>{date.toFormat("cccc")}</Text>
				</Group>
			</Card.Section>
			<Text mt="sm" color="dimmed" size="sm">
				<Text component="span" inherit color="blue">
					200+ images uploaded
				</Text>{" "}
				since last visit, review them to select which one should be added to
				your gallery
			</Text>
		</Card>
	);
};

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
					{calendarEvents.data ? (
						<Box>
							{calendarEvents.data.length > 0 ? (
								calendarEvents.data.map((ce) => (
									<CalendarEvent day={ce} key={ce.date} />
								))
							) : (
								<Text italic>No events in this time period</Text>
							)}
						</Box>
					) : (
						<Group position="center">
							<Loader size="lg" />
						</Group>
					)}
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
