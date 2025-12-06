import {
	ActionIcon,
	Button,
	Container,
	Group,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	UserCalendarEventsDocument,
	type UserCalendarEventsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { sum } from "@ryot/ts-utils";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import {
	DisplayListDetailsAndRefresh,
	SkeletonLoader,
} from "~/components/common";
import { ApplicationGrid } from "~/components/common/layout";
import { MetadataDisplayItem } from "~/components/media/display-items";
import { dayjsLib } from "~/lib/shared/date-utils";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";

interface FilterState {
	date: string;
}

const defaultFilterState: FilterState = {
	date: new Date().toISOString(),
};

export const meta = () => {
	return [{ title: "Calendar | Ryot" }];
};

export default function Page() {
	const [filters, setFilters] = useLocalStorage(
		"CalendarFilters",
		defaultFilterState,
	);

	const date = dayjsLib(filters.date);

	const { data: userCalendarEvents } = useQuery({
		queryKey: queryFactory.calendar.userCalendarEvents({
			year: date.year(),
			month: date.month() + 1,
		}).queryKey,
		queryFn: () =>
			clientGqlService
				.request(UserCalendarEventsDocument, {
					input: { month: date.month() + 1, year: date.year() },
				})
				.then((data) => data.userCalendarEvents),
	});

	const updateDate = (newDate: string) =>
		setFilters((prev) => ({ ...prev, date: newDate }));

	return (
		<Container>
			<Stack>
				<Group justify="space-between">
					<Title order={3} td="underline">
						{date.format("MMMM, YYYY")}
					</Title>
					<Button.Group>
						<ActionIcon
							variant="outline"
							onClick={() => {
								const newMonth = date.subtract(1, "month");
								updateDate(newMonth.toISOString());
							}}
						>
							<IconChevronLeft />
						</ActionIcon>
						<ActionIcon
							variant="outline"
							ml="xs"
							onClick={() => {
								const newMonth = date.add(1, "month");
								updateDate(newMonth.toISOString());
							}}
						>
							<IconChevronRight />
						</ActionIcon>
					</Button.Group>
				</Group>
				{userCalendarEvents ? (
					userCalendarEvents.length > 0 ? (
						<Stack gap={4}>
							<DisplayListDetailsAndRefresh
								total={sum(userCalendarEvents.map((e) => e.events.length))}
							/>
							{userCalendarEvents.map((ce) => (
								<CalendarDate key={ce.date} data={ce} />
							))}
						</Stack>
					) : (
						<Text fs="italic">No events in this time period</Text>
					)
				) : (
					<SkeletonLoader />
				)}
			</Stack>
		</Container>
	);
}

type CalendarDate = UserCalendarEventsQuery["userCalendarEvents"][number];

const CalendarEventMetadata = (props: {
	item: CalendarDate["events"][number];
}) => {
	const additionalInformation = useMemo(() => {
		if (props.item.showExtraInformation)
			return `Upcoming: S${props.item.showExtraInformation?.season}-E${props.item.showExtraInformation?.episode}`;
		if (props.item.podcastExtraInformation)
			return `Upcoming: EP-${props.item.podcastExtraInformation?.episode}`;
	}, []);

	return (
		<MetadataDisplayItem
			metadataId={props.item.metadataId}
			additionalInformation={additionalInformation}
		/>
	);
};

const CalendarDate = (props: {
	data: CalendarDate;
}) => {
	const date = dayjsLib(props.data.date);

	return (
		<>
			<Group data-calendar-date={props.data.date}>
				<Text fz={{ base: "h1" }} fw="bold">
					{date.format("D")}
				</Text>
				<Stack gap={2}>
					<Text size="sm" style={{ lineHeight: "0.9" }}>
						{date.format("MMMM")}
					</Text>
					<Text size="sm" fw="bold">
						{date.format("dddd")}
					</Text>
				</Stack>
			</Group>
			<ApplicationGrid>
				{props.data.events.map((calEvent) => (
					<CalendarEventMetadata
						item={calEvent}
						key={calEvent.calendarEventId}
					/>
				))}
			</ApplicationGrid>
		</>
	);
};
