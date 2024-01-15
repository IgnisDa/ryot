import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Anchor,
	Box,
	Center,
	Container,
	Group,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useDidUpdate } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { PublicCollectionsListDocument } from "@ryot/generated/graphql/backend/graphql";
import { IconSearch, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, ApplicationPagination } from "~/components/common";
import { gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";
import { useGetMantineColor, useSearchParam } from "~/lib/hooks";

const searchParamsSchema = z.object({
	page: zx.IntAsString.optional(),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [coreDetails, { publicCollectionsList }] = await Promise.all([
		getCoreDetails(),
		gqlClient.request(PublicCollectionsListDocument, { input: query }),
	]);
	return json({
		coreDetails: { pageLimit: coreDetails.pageLimit },
		query,
		publicCollectionsList,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Public collections | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useSearchParam();
	const [query, setQuery] = useState(loaderData.query.query || "");
	const getMantineColor = useGetMantineColor();

	useDidUpdate(() => setP("query", query), [query]);

	return (
		<>
			<Container>
				<Stack>
					<Title>Public collections</Title>
					<TextInput
						name="query"
						placeholder="Search for collections"
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
					{loaderData.publicCollectionsList.details.total > 0 ? (
						<>
							<Box>
								<Text display="inline" fw="bold">
									{loaderData.publicCollectionsList.details.total}
								</Text>{" "}
								items found
							</Box>
							<ApplicationGrid>
								{loaderData.publicCollectionsList.items.map((c) => (
									<Group key={c.id}>
										<Box
											h={11}
											w={11}
											style={{ borderRadius: 2 }}
											bg={getMantineColor(c.name)}
										/>
										<Box>
											<Anchor
												component={Link}
												to={$path("/collections/:id", { id: c.id })}
											>
												<Title order={4}>{c.name}</Title>
											</Anchor>
											<Text c="dimmed" size="xs">
												by {c.username}
											</Text>
										</Box>
									</Group>
								))}
							</ApplicationGrid>
						</>
					) : (
						<Text>No public collections found</Text>
					)}
					{loaderData.publicCollectionsList ? (
						<Center mt="xl">
							<ApplicationPagination
								size="sm"
								defaultValue={loaderData.query.page}
								onChange={(v) => setP("page", v.toString())}
								total={Math.ceil(
									loaderData.publicCollectionsList.details.total /
										loaderData.coreDetails.pageLimit,
								)}
							/>
						</Center>
					) : null}
				</Stack>
			</Container>
		</>
	);
}
