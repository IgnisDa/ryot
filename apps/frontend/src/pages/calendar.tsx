import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "@/lib/constants";
import { useCoreDetails } from "@/lib/hooks";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import {
	ActionIcon,
	Anchor,
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
import { snakeCase, startCase, sum } from "@ryot/ts-utils";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Head from "next/head";
import Link from "next/link";
import { type ReactElement } from "react";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "./_app";

const CalendarEvent = (props: {
	day: UserCalendarEventsQuery["userCalendarEvents"][number];
}) => {
	const date = DateTime.fromISO(props.day.date);

	return (
		<Card
			data-calendar-date={props.day.date}
			withBorder
			radius="sm"
			padding="xs"
			mt="sm"
		>
			<Card.Section withBorder p="sm">
				<Group justify="space-between">
					<Text>{date.toFormat("d LLLL")}</Text>
					<Text>{date.toFormat("cccc")}</Text>
				</Group>
			</Card.Section>
			{props.day.events.map((evt) => (
				<Group
					key={evt.calendarEventId}
					data-calendar-event-id={evt.calendarEventId}
					justify="space-between"
					align="end"
				>
					<Text mt="sm" size="sm">
						<Anchor
							component={Link}
							href={withQuery(APP_ROUTES.media.individualMediaItem.details, {
								id: evt.metadataId,
							})}
						>
							{evt.metadataTitle}
						</Anchor>{" "}
						{typeof evt.showSeasonNumber === "number" ? (
							<Text span color="dimmed" size="sm">
								(S{evt.showSeasonNumber}-E
								{evt.showEpisodeNumber})
							</Text>
						) : undefined}
						{typeof evt.podcastEpisodeNumber === "number" ? (
							<Text span color="dimmed" size="sm">
								(EP-{evt.podcastEpisodeNumber})
							</Text>
						) : undefined}
					</Text>
					<Text size="sm" color="dimmed">
						{startCase(snakeCase(evt.metadataLot))}
					</Text>
				</Group>
			))}
		</Card>
	);
};

const Page: NextPageWithLayout = () => {
	const coreDetails = useCoreDetails();
	const [selectedMonth, setMonth] = useLocalStorage({
		defaultValue: DateTime.now(),
		key: LOCAL_STORAGE_KEYS.savedCalendarDay,
		getInitialValueInEffect: false,
		serialize: (value) => {
			return value.toISO() as string;
		},
		deserialize: (value) => {
			return value ? DateTime.fromISO(value) : DateTime.now();
		},
	});

	const calendarEvents = useQuery({
		queryKey: ["calendarEvents", selectedMonth],
		queryFn: async () => {
			if (selectedMonth === undefined) return;
			const { userCalendarEvents } = await gqlClient.request(
				UserCalendarEventsDocument,
				{ input: { month: selectedMonth.month, year: selectedMonth.year } },
			);
			return userCalendarEvents;
		},
		staleTime: Infinity,
	});

	return coreDetails.data && selectedMonth ? (
		<>
			<Head>
				<title>Calendar</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Group justify="space-between">
						<Title order={3} td="underline">
							{selectedMonth.toFormat("LLLL, yyyy")}
						</Title>
						<Button.Group>
							<ActionIcon
								variant="outline"
								onClick={() => {
									const newMonth = selectedMonth.minus({ month: 1 });
									setMonth(newMonth);
								}}
							>
								<IconChevronLeft />
							</ActionIcon>
							<ActionIcon
								variant="outline"
								ml="xs"
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
						calendarEvents.data.length > 0 ? (
							<Box>
								<Box>
									<Text display="inline" fw="bold">
										{sum(calendarEvents.data.map((e) => e.events.length))}
									</Text>{" "}
									items found
								</Box>
								{calendarEvents.data.map((ce) => (
									<CalendarEvent day={ce} key={ce.date} />
								))}
							</Box>
						) : (
							<Text fs="italic">No events in this time period</Text>
						)
					) : (
						<Group justify="space-between">
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
