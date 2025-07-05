import {
	ActionIcon,
	Box,
	Button,
	Container,
	Group,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	MediaLot,
	UserCalendarEventsDocument,
	type UserCalendarEventsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { parseSearchQuery, sum } from "@ryot/ts-utils";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useLoaderData } from "react-router";
import { Fragment } from "react/jsx-runtime";
import { match } from "ts-pattern";
import { z } from "zod";
import { ApplicationGrid } from "~/components/common";
import { MetadataDisplayItem } from "~/components/media";
import { dayjsLib } from "~/lib/shared/date-utils";
import { useAppSearchParam } from "~/lib/shared/hooks";
import {
	getSearchEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.calendar";

const searchParamsSchema = z.object({
	date: z.coerce.date().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: Route.LoaderArgs) => {
	const cookieName = await getSearchEnhancedCookieName("calendar", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = parseSearchQuery(request, searchParamsSchema);
	const date = dayjsLib(query.date);
	const [{ userCalendarEvents }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, UserCalendarEventsDocument, {
			input: { month: date.month() + 1, year: date.year() },
		}),
	]);
	return { userCalendarEvents, cookieName, query };
};

export const meta = () => {
	return [{ title: "Calendar | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const date = dayjsLib(loaderData.query.date);

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
				{loaderData.userCalendarEvents.length > 0 ? (
					<Stack gap={4}>
						<Box>
							<Text display="inline" fw="bold">
								{sum(loaderData.userCalendarEvents.map((e) => e.events.length))}
							</Text>{" "}
							items found
						</Box>
						{loaderData.userCalendarEvents.map((ce) => (
							<CalendarEvent key={ce.date} data={ce} />
						))}
					</Stack>
				) : (
					<Text fs="italic">No events in this time period</Text>
				)}
			</Stack>
		</Container>
	);
}

const CalendarEvent = (props: {
	data: UserCalendarEventsQuery["userCalendarEvents"][number];
}) => {
	const date = dayjsLib(props.data.date);

	return (
		<Fragment>
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
					<MetadataDisplayItem
						noLeftLabel
						key={calEvent.calendarEventId}
						altName={calEvent.metadataText}
						metadataId={calEvent.metadataId}
						rightLabel={`${match(calEvent.metadataLot)
							.with(
								MediaLot.Show,
								() =>
									`S${calEvent.showExtraInformation?.season}-E${calEvent.showExtraInformation?.episode}`,
							)
							.with(
								MediaLot.Podcast,
								() => `EP-${calEvent.podcastExtraInformation?.episode}`,
							)
							.otherwise(() => "")}`}
					/>
				))}
			</ApplicationGrid>
		</Fragment>
	);
};
