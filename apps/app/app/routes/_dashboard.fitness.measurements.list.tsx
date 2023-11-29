import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { UserMeasurementsListDocument } from "@ryot/generated/graphql/backend/graphql";
import { DateTime } from "luxon";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getUserPreferences } from "~/lib/graphql.server";

enum TimeSpan {
	Last7Days = "Last 7 days",
	Last30Days = "Last 30 days",
	Last90Days = "Last 90 days",
	Last365Days = "Last 365 days",
	AllTime = "All Time",
}

const searchParamsSchema = z.object({
	timeSpan: z.nativeEnum(TimeSpan).default(TimeSpan.Last30Days),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const now = DateTime.now();
	const [startTime, endTime] = match(query.timeSpan)
		.with(TimeSpan.Last7Days, () => [now, now.minus({ days: 7 })])
		.with(TimeSpan.Last30Days, () => [now, now.minus({ days: 30 })])
		.with(TimeSpan.Last90Days, () => [now, now.minus({ days: 90 })])
		.with(TimeSpan.Last365Days, () => [now, now.minus({ days: 365 })])
		.with(TimeSpan.AllTime, () => [null, null])
		.exhaustive();
	const [userPreferences, { userMeasurementsList }] = await Promise.all([
		getUserPreferences(request),
		gqlClient.request(
			UserMeasurementsListDocument,
			{ input: { startTime: startTime?.toISO(), endTime: endTime?.toISO() } },
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		query,
		userPreferences,
		userMeasurementsList,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Measurements | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Box>{JSON.stringify(loaderData)}</Box>
		</Container>
	);
}

const dateFormatter = (date: Date) => {
	return DateTime.fromJSDate(date).toLocaleString(DateTime.DATETIME_SHORT);
};
