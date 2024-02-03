import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Card,
	Container,
	Group,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
	UserCalendarEventsDocument,
	UserCalendarEventsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { snakeCase, startCase, sum } from "@ryot/ts-utils";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { dayjsLib } from "~/lib/generals";
import { getCoreDetails } from "~/lib/graphql.server";
import { useSearchParam } from "~/lib/hooks";

const searchParamsSchema = z.object({
	date: z
		.string()
		.default(() => new Date().toISOString())
		.transform((v) => dayjsLib(v)),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [coreDetails, { userCalendarEvents }] = await Promise.all([
		getCoreDetails(),
		gqlClient.request(
			UserCalendarEventsDocument,
			{ input: { month: query.date.month() + 1, year: query.date.year() } },
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		query,
		coreDetails,
		calendarEvents: userCalendarEvents,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Calendar | Ryot" }];
};

export default function Page() {
	const [_, { setP }] = useSearchParam();
	const loaderData = useLoaderData<typeof loader>();
	const date = dayjsLib(loaderData.query.date);

	return (
		<Container size="xs">
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
								setP("date", newMonth.toISOString());
							}}
						>
							<IconChevronLeft />
						</ActionIcon>
						<ActionIcon
							variant="outline"
							ml="xs"
							onClick={() => {
								const newMonth = date.add(1, "month");
								setP("date", newMonth.toISOString());
							}}
						>
							<IconChevronRight />
						</ActionIcon>
					</Button.Group>
				</Group>
				{loaderData.calendarEvents.length > 0 ? (
					<Box>
						<Box>
							<Text display="inline" fw="bold">
								{sum(loaderData.calendarEvents.map((e) => e.events.length))}
							</Text>{" "}
							items found
						</Box>
						{loaderData.calendarEvents.map((ce) => (
							<CalendarEvent day={ce} key={ce.date} />
						))}
					</Box>
				) : (
					<Text fs="italic">No events in this time period</Text>
				)}
			</Stack>
		</Container>
	);
}

const CalendarEvent = (props: {
	day: UserCalendarEventsQuery["userCalendarEvents"][number];
}) => {
	const date = dayjsLib(props.day.date);

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
					<Text>{date.format("D MMMM")}</Text>
					<Text>{date.format("dddd")}</Text>
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
							to={$path("/media/item/:id", {
								id: evt.metadataId,
							})}
						>
							{evt.metadataTitle}
						</Anchor>{" "}
						{typeof evt.showExtraInformation?.season === "number" ? (
							<Text span c="dimmed" size="sm">
								(S{evt.showExtraInformation.season}-E
								{evt.showExtraInformation.episode})
							</Text>
						) : null}
						{typeof evt.podcastExtraInformation?.episode === "number" ? (
							<Text span c="dimmed" size="sm">
								(EP-{evt.podcastExtraInformation.episode})
							</Text>
						) : null}
					</Text>
					<Text size="sm" c="dimmed">
						{startCase(snakeCase(evt.metadataLot))}
					</Text>
				</Group>
			))}
		</Card>
	);
};
