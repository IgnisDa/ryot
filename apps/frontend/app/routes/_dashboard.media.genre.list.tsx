import { $path } from "@ignisda/remix-routes";
import {
	Anchor,
	Box,
	Center,
	Container,
	Flex,
	Group,
	Pagination,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { unstable_defineLoader } from "@remix-run/node";
import {
	Link,
	type MetaArgs_SingleFetch,
	useLoaderData,
} from "@remix-run/react";
import { GenresListDocument } from "@ryot/generated/graphql/backend/graphql";
import { truncate } from "@ryot/ts-utils";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, DebouncedSearchInput } from "~/components/common";
import {
	useAppSearchParam,
	useCoreDetails,
	useGetMantineColor,
} from "~/lib/hooks";
import {
	enhancedServerGqlService,
	getEnhancedCookieName,
	redirectUsingEnhancedCookieSearchParams,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request }) => {
	const cookieName = await getEnhancedCookieName("genre.list", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ genresList }] = await Promise.all([
		enhancedServerGqlService.request(GenresListDocument, {
			input: { page: query.page, query: query.query },
		}),
	]);
	return { query, genresList, cookieName };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Genres | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const getMantineColor = useGetMantineColor();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);

	return (
		<Container>
			<Stack>
				<Flex align="center" gap="md">
					<Title>Genres</Title>
				</Flex>
				<DebouncedSearchInput
					placeholder="Search for genres"
					initialValue={loaderData.query.query}
					enhancedQueryParams={loaderData.cookieName}
				/>
				{loaderData.genresList.details.total > 0 ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.genresList.details.total}
							</Text>{" "}
							items found
						</Box>
						<ApplicationGrid>
							{loaderData.genresList.items.map((genre) => (
								<Paper key={genre.id}>
									<Group>
										<Box
											h={11}
											w={11}
											style={{ borderRadius: 2 }}
											bg={getMantineColor(genre.name)}
										/>
										<Box>
											<Anchor
												component={Link}
												to={$path("/media/genre/:id", { id: genre.id })}
											>
												{truncate(genre.name, { length: 13 })}
											</Anchor>
											<Text size="sm" c="dimmed">
												{genre.numItems} items
											</Text>
										</Box>
									</Group>
								</Paper>
							))}
						</ApplicationGrid>
					</>
				) : (
					<Text>No information to display</Text>
				)}
				{loaderData.genresList ? (
					<Center mt="xl">
						<Pagination
							size="sm"
							value={loaderData.query.page}
							onChange={(v) => setP("page", v.toString())}
							total={Math.ceil(
								loaderData.genresList.details.total / coreDetails.pageLimit,
							)}
						/>
					</Center>
				) : null}
			</Stack>
		</Container>
	);
}
