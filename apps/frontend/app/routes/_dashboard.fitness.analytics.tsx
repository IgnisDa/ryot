import { Box, Container, Stack } from "@mantine/core";
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { zx } from "zodix";
import {
	getEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	startDate: z.string().optional(),
	endDate: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, {});
	const cookieName = await getEnhancedCookieName("fitness.analytics", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	return { query };
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Fitness Analytics | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<Container>
			<Stack>
				<Box>{JSON.stringify(loaderData.query)}</Box>
			</Stack>
		</Container>
	);
}
