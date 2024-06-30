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
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, DebouncedSearchInput } from "~/components/common";
import {
	useCoreDetails,
	useGetMantineColor,
	useSearchParam,
} from "~/lib/hooks";
import { serverGqlService } from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request }) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ genresList }] = await Promise.all([
		serverGqlService.request(GenresListDocument, {
			input: { page: query.page, query: query.query },
		}),
	]);
	return { query, listGenres: genresList };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Genres | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
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
								loaderData.listGenres.details.total / coreDetails.pageLimit,
							)}
						/>
					</Center>
				) : null}
			</Stack>
		</Container>
	);
}
