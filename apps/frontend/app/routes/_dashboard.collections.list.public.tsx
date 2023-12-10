import { $path } from "@ignisda/remix-routes";
import {
	Anchor,
	Box,
	Container,
	Flex,
	Group,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { PublicCollectionsListDocument } from "@ryot/generated/graphql/backend/graphql";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid } from "~/components/common";
import { gqlClient } from "~/lib/api.server";
import { useGetMantineColor } from "~/lib/hooks";

const searchParamsSchema = z.object({
	page: zx.IntAsString.optional(),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ publicCollectionsList }] = await Promise.all([
		gqlClient.request(PublicCollectionsListDocument, { input: query }),
	]);
	return json({ publicCollectionsList });
};

export const meta: MetaFunction = () => {
	return [{ title: "Public collections | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const getMantineColor = useGetMantineColor();

	return (
		<>
			<Container>
				<Stack>
					<Flex align="center" gap="xs">
						<Title>Public collections</Title>
						<Text c="dimmed">
							{loaderData.publicCollectionsList.details.total} items
						</Text>
					</Flex>
					{loaderData.publicCollectionsList.details.total > 0 ? (
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
					) : (
						<Text>No public collections found</Text>
					)}
				</Stack>
			</Container>
		</>
	);
}
