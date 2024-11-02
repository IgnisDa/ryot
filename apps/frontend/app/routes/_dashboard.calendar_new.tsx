import { Container } from "@mantine/core";
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { UserCalendarEventsDocument } from "@ryot/generated/graphql/backend/graphql";
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
	const [{ userCalendarEvents }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, UserCalendarEventsDocument, {
			input: { month: date.month() + 1, year: date.year() },
		}),
	]);
	return { query, userCalendarEvents, cookieName };
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Calendar | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container size="xs">
			Hello world to the calendar
			<div>{JSON.stringify(loaderData, null, 4)}</div>
		</Container>
	);
}
