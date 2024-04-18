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
import {
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
} from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { GenresListDocument } from "@ryot/generated/graphql/backend/graphql";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, DebouncedSearchInput } from "~/components/common";
import { useGetMantineColor, useSearchParam } from "~/lib/hooks";
import { getCoreDetails, gqlClient } from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [coreDetails, { genresList }] = await Promise.all([
		getCoreDetails(request),
		gqlClient.request(GenresListDocument, {
			input: { page: query.page, query: query.query },
		}),
	]);
	return json({ coreDetails, query, listGenres: genresList });
};

export const meta: MetaFunction = () => {
	return [{ title: "Genres | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const getMantineColor = useGetMantineColor();
	const [_, { setP }] = useSearchParam();

	return (
		<Container>
			<Stack>
				<Flex align="center" gap="md">
					<Title>Genres</Title>
				</Flex>
				<DebouncedSearchInput
					placeholder="Search for genres"
					initialValue={loaderData.query.query}
				/>
				{loaderData.listGenres.details.total > 0 ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.listGenres.details.total}
							</Text>{" "}
							items found
						</Box>
						<ApplicationGrid>
							{loaderData.listGenres.items.map((genre) => (
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
												{genre.name.substring(0, 13).trim()}
												{genre.name.length > 13 ? "..." : ""}
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
				{loaderData.listGenres ? (
					<Center mt="xl">
						<Pagination
							size="sm"
							value={loaderData.query.page}
							onChange={(v) => setP("page", v.toString())}
							total={Math.ceil(
								loaderData.listGenres.details.total /
									loaderData.coreDetails.pageLimit,
							)}
						/>
					</Center>
				) : null}
			</Stack>
		</Container>
	);
}
