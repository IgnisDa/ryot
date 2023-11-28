import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { UserCalendarEventsDocument } from "@ryot/generated/graphql/backend/graphql";
import { DateTime } from "luxon";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";

const searchParamsSchema = z.object({
	date: z
		.string()
		.datetime()
		.default(() => new Date().toISOString())
		.transform((v) => DateTime.fromISO(v)),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [coreDetails, calendarEvents] = await Promise.all([
		getCoreDetails(),
		gqlClient.request(
			UserCalendarEventsDocument,
			{ input: { month: query.date.month, year: query.date.year } },
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		query,
		coreDetails,
		calendarEvents,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Calendar | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}
