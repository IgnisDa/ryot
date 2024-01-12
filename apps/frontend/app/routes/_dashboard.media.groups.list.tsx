import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Box,
	Center,
	Container,
	Flex,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useDidUpdate } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { MetadataGroupsListDocument } from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials, snakeCase } from "@ryot/ts-utils";
import { IconSearch, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, ApplicationPagination } from "~/components/common";
import { BaseDisplayItem } from "~/components/media";
import { gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";
import { useSearchParam } from "~/lib/hooks";

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [coreDetails, { metadataGroupsList }] = await Promise.all([
		getCoreDetails(),
		gqlClient.request(MetadataGroupsListDocument, {
			input: { page: query.page, query: query.query },
		}),
	]);
	return json({
		coreDetails: { pageLimit: coreDetails.pageLimit },
		query,
		metadataGroupsList,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Groups | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useSearchParam();
	const [query, setQuery] = useState(loaderData.query.query || "");

	useDidUpdate(() => setP("query", query), [query]);

	return (
		<Container>
			<Stack>
				<Flex align="center" gap="md">
					<Title>Groups</Title>
				</Flex>
				<TextInput
					name="query"
					placeholder="Search for groups"
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
				{loaderData.metadataGroupsList.details.total > 0 ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.metadataGroupsList.details.total}
							</Text>{" "}
							items found
						</Box>
						<ApplicationGrid>
							{loaderData.metadataGroupsList.items.map((group) => (
								<BaseDisplayItem
									name={group.title}
									bottomLeft={`${group.parts} items`}
									bottomRight={changeCase(snakeCase(group.lot))}
									imageLink={group.image}
									imagePlaceholder={getInitials(group.title)}
									key={group.id}
									href={$path("/media/groups/:id", { id: group.id })}
								/>
							))}
						</ApplicationGrid>
					</>
				) : (
					<Text>No information to display</Text>
				)}
				{loaderData.metadataGroupsList ? (
					<Center>
						<ApplicationPagination
							size="sm"
							defaultValue={loaderData.query.page}
							onChange={(v) => setP("page", v.toString())}
							total={Math.ceil(
								loaderData.metadataGroupsList.details.total /
									loaderData.coreDetails.pageLimit,
							)}
						/>
					</Center>
				) : null}
			</Stack>
		</Container>
	);
}
