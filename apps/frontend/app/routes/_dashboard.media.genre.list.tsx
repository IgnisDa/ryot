import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Anchor,
	Box,
	Center,
	Container,
	Flex,
	Group,
	Paper,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useDidUpdate } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { GenresListDocument } from "@ryot/generated/graphql/backend/graphql";
import { IconSearch, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, ApplicationPagination } from "~/components/common";
import { gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";
import { useGetMantineColor, useSearchParam } from "~/lib/hooks";

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [coreDetails, { genresList }] = await Promise.all([
		getCoreDetails(),
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
	const [query, setQuery] = useState(loaderData.query.query || "");

	useDidUpdate(() => setP("query", query), [query]);

	return (
		<Container>
			<Stack>
				<Flex align="center" gap="md">
					<Title>Genres</Title>
				</Flex>
				<TextInput
					name="query"
					placeholder="Search for genres"
					leftSection={<IconSearch />}
					onChange={(e) => setQuery(e.currentTarget.value)}
					value={query}
					rightSection={
						query ? (
							<ActionIcon onClick={() => setQuery("")}>
								<IconX size={16} />
							</ActionIcon>
						) : null
					}
					style={{ flexGrow: 1 }}
					autoCapitalize="none"
					autoComplete="off"
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
						<ApplicationPagination
							size="sm"
							defaultValue={loaderData.query.page}
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
