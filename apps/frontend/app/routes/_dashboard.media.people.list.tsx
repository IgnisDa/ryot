import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Box,
	Center,
	Container,
	Flex,
	Group,
	Modal,
	Select,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useDidUpdate, useDisclosure } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
	GraphqlSortOrder,
	PeopleListDocument,
	PersonSortBy,
} from "@ryot/generated/graphql/backend/graphql";
import { getInitials, startCase } from "@ryot/ts-utils";
import {
	IconFilter,
	IconFilterOff,
	IconSearch,
	IconSortAscending,
	IconSortDescending,
	IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, ApplicationPagination } from "~/components/common";
import { BaseDisplayItem } from "~/components/media";
import { gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";
import { useSearchParam } from "~/lib/hooks";

const defaultFilters = {
	sortBy: PersonSortBy.MediaItems,
	orderBy: GraphqlSortOrder.Desc,
};

const searchParamsSchema = z.object({
	page: zx.IntAsString.default("1"),
	query: z.string().optional(),
	sortBy: z.nativeEnum(PersonSortBy).default(defaultFilters.sortBy),
	orderBy: z.nativeEnum(GraphqlSortOrder).default(defaultFilters.orderBy),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [coreDetails, { peopleList }] = await Promise.all([
		getCoreDetails(),
		gqlClient.request(PeopleListDocument, {
			input: {
				search: { page: query.page, query: query.query },
				sort: { by: query.sortBy, order: query.orderBy },
			},
		}),
	]);
	return json({
		query,
		coreDetails: { pageLimit: coreDetails.pageLimit },
		peopleList,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "People | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const [_, { setP }] = useSearchParam();
	const [query, setQuery] = useState(loaderData.query.query || "");
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);

	useDidUpdate(() => setP("query", query), [query]);

	return (
		<Container>
			<Stack>
				<Flex align="center" gap="md">
					<Title>People</Title>
				</Flex>
				<Group wrap="nowrap">
					<TextInput
						name="query"
						placeholder="Search for people"
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
					<ActionIcon
						onClick={openFiltersModal}
						color={
							loaderData.query.orderBy !== defaultFilters.orderBy ||
							loaderData.query.sortBy !== defaultFilters.sortBy
								? "blue"
								: "gray"
						}
					>
						<IconFilter size={24} />
					</ActionIcon>
					<Modal
						opened={filtersModalOpened}
						onClose={closeFiltersModal}
						centered
						withCloseButton={false}
					>
						<Stack>
							<Group>
								<Title order={3}>Sort by</Title>
								<ActionIcon
									onClick={() => {
										navigate(".");
										closeFiltersModal();
									}}
								>
									<IconFilterOff size={24} />
								</ActionIcon>
							</Group>
							<Flex gap="xs" align="center">
								<Select
									w="100%"
									data={Object.values(PersonSortBy).map((o) => ({
										value: o.toString(),
										label: startCase(o.toLowerCase()),
									}))}
									defaultValue={loaderData.query.sortBy}
									onChange={(v) => setP("sortBy", v)}
								/>
								<ActionIcon
									onClick={() => {
										if (loaderData.query.orderBy === GraphqlSortOrder.Asc)
											setP("orderBy", GraphqlSortOrder.Desc);
										else setP("orderBy", GraphqlSortOrder.Asc);
									}}
								>
									{loaderData.query.orderBy === GraphqlSortOrder.Asc ? (
										<IconSortAscending />
									) : (
										<IconSortDescending />
									)}
								</ActionIcon>
							</Flex>
						</Stack>
					</Modal>
				</Group>
				{loaderData.peopleList.details.total > 0 ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.peopleList.details.total}
							</Text>{" "}
							items found
						</Box>
						<ApplicationGrid>
							{loaderData.peopleList.items.map((creator) => (
								<BaseDisplayItem
									name={creator.name}
									bottomLeft={`${creator.mediaCount} items`}
									imageLink={creator.image}
									imagePlaceholder={getInitials(creator.name)}
									key={creator.id}
									href={$path("/media/people/:id", { id: creator.id })}
								/>
							))}
						</ApplicationGrid>
					</>
				) : (
					<Text>No information to display</Text>
				)}
				{loaderData.peopleList ? (
					<Center>
						<ApplicationPagination
							size="sm"
							defaultValue={loaderData.query.page}
							onChange={(v) => setP("page", v.toString())}
							total={Math.ceil(
								loaderData.peopleList.details.total /
									loaderData.coreDetails.pageLimit,
							)}
						/>
					</Center>
				) : null}
			</Stack>
		</Container>
	);
}
