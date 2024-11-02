import { Container, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { UserCalendarEventsDocument } from "@ryot/generated/graphql/backend/graphql";
import { sum } from "@ryot/ts-utils";
import { Fragment } from "react/jsx-runtime";
import { z } from "zod";
import { zx } from "zodix";
import { dayjsLib } from "~/lib/generals";
import {
	getEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	date: z.coerce.date().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const cookieName = await getEnhancedCookieName("calendar", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = zx.parseQuery(request, searchParamsSchema);
	const date = dayjsLib(query.date);
	const month = date.month() + 1;
	const year = date.year();
	const [{ userCalendarEvents }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, UserCalendarEventsDocument, {
			input: { month, year },
		}),
	]);
	return { userCalendarEvents, cookieName, month, year };
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Calendar | Ryot" }];
};

const weekdays = dayjsLib().localeData().weekdays();

const generateCalendar = (year: number, month: number) => {
	const startDate = dayjsLib(`${year}-${month.toString().padStart(2, "0")}-01`);
	const daysInMonth = startDate.daysInMonth();
	const startDayOfWeek = startDate.day();

	const calendar = Array<(number | null)[]>();
	let week = Array(7).fill(null);
	let dayCounter = 1;

	for (let i = startDayOfWeek; i < 7; i++)
		if (dayCounter <= daysInMonth) week[i] = dayCounter++;
	calendar.push([...week]);

	while (dayCounter <= daysInMonth) {
		week = Array(7).fill(null);
		for (let i = 0; i < 7 && dayCounter <= daysInMonth; i++)
			week[i] = dayCounter++;
		calendar.push([...week]);
	}

	return calendar;
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const calendar = generateCalendar(loaderData.year, loaderData.month);

	return (
		<Container size="sm">
			<Stack>
				<SimpleGrid cols={7} spacing={{ base: "xs", md: "md" }}>
					{weekdays.map((wkd) => (
						<Paper
							py={2}
							key={wkd}
							radius="lg"
							withBorder
							px={{ base: 6, md: "md" }}
						>
							<Text fz={{ base: "xs", md: "lg" }} ta="center">
								{wkd.slice(0, 3)}
							</Text>
						</Paper>
					))}
				</SimpleGrid>
				{calendar.map((week) => (
					<SimpleGrid cols={7} key={sum(week)}>
						{week.map((day, index) => (
							<Fragment key={index.toString()}>
								<Paper
									withBorder={day !== null}
									p={{ base: 6, md: "md" }}
									radius={day === null ? undefined : "lg"}
									shadow={day === null ? undefined : "xl"}
								>
									<Text ta="center" fz={{ base: "xs", md: "lg" }}>
										{day}
									</Text>
								</Paper>
							</Fragment>
						))}
					</SimpleGrid>
				))}
			</Stack>
		</Container>
	);
}
