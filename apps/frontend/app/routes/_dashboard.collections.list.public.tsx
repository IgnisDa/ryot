import { $path } from "@ignisda/remix-routes";
import {
	Anchor,
	Box,
	Center,
	Container,
	Group,
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
import { PublicCollectionsListDocument } from "@ryot/generated/graphql/backend/graphql";
import { z } from "zod";
import { zx } from "zodix";
import {
	ApplicationGrid,
	ApplicationPagination,
	DebouncedSearchInput,
} from "~/components/common";
import { useGetMantineColor, useSearchParam } from "~/lib/hooks";
import { getCoreDetails, gqlClient } from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	page: zx.IntAsString.optional(),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [coreDetails, { publicCollectionsList }] = await Promise.all([
		getCoreDetails(request),
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
	const getMantineColor = useGetMantineColor();

	return (
		<>
			<Container>
				<Stack>
					<Title>Public collections</Title>
					<DebouncedSearchInput
						placeholder="Search in the collection"
						initialValue={loaderData.query.query}
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
									<Group key={c.id} wrap="nowrap">
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
												<Title order={4} lineClamp={1}>
													{c.name}
												</Title>
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
								value={loaderData.query.page}
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
