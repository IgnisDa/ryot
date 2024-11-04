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
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { UserCalendarEventsDocument } from "@ryot/generated/graphql/backend/graphql";
import { sum } from "@ryot/ts-utils";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { z } from "zod";
import { zx } from "zodix";
import { dayjsLib } from "~/lib/generals";
import { useAppSearchParam } from "~/lib/hooks";
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
	const [{ userCalendarEvents }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, UserCalendarEventsDocument, {
			input: { month: date.month() + 1, year: date.year() },
		}),
	]);
	return { userCalendarEvents, cookieName, query };
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Calendar | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
	const date = dayjsLib(loaderData.query.date);

	return (
		<Container size="sm" h="100%" mt="auto">
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
					<Box>
						<Box>
							<Text display="inline" fw="bold">
								{sum(loaderData.userCalendarEvents.map((e) => e.events.length))}
							</Text>{" "}
							items found
						</Box>
					</Box>
				) : (
					<Text fs="italic">No events in this time period</Text>
				)}
			</Stack>
		</Container>
	);
}
