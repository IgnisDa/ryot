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
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
	GraphqlSortOrder,
	MediaSource,
	PeopleListDocument,
	PeopleSearchDocument,
	PersonSortBy,
} from "@ryot/generated/graphql/backend/graphql";
import { getInitials, startCase } from "@ryot/ts-utils";
import {
	IconFilter,
	IconFilterOff,
	IconSortAscending,
	IconSortDescending,
} from "@tabler/icons-react";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import {
	ApplicationGrid,
	ApplicationPagination,
	DebouncedSearchInput,
} from "~/components/common";
import { BaseDisplayItem } from "~/components/media";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails } from "~/lib/graphql.server";
import { useSearchParam } from "~/lib/hooks";

const defaultFilters = {
	sortBy: PersonSortBy.MediaItems,
	orderBy: GraphqlSortOrder.Desc,
};

enum Action {
	Search = "search",
	List = "list",
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const action = params.action as Action;
	const coreDetails = await getCoreDetails();
	const [peopleList, peopleSearch] = await match(action)
		.with(Action.List, async () => {
			const query = zx.parseQuery(
				request,
				z.object({
					page: zx.IntAsString.default("1"),
					query: z.string().optional(),
					sortBy: z.nativeEnum(PersonSortBy).default(defaultFilters.sortBy),
					orderBy: z
						.nativeEnum(GraphqlSortOrder)
						.default(defaultFilters.orderBy),
				}),
			);
			const { peopleList } = await gqlClient.request(
				PeopleListDocument,
				{
					input: {
						search: { page: query.page, query: query.query },
						sort: { by: query.sortBy, order: query.orderBy },
					},
				},
				await getAuthorizationHeader(request),
			);
			return [{ list: peopleList, url: query }, undefined] as const;
		})
		.with(Action.Search, async () => {
			const query = zx.parseQuery(
				request,
				z.object({
					source: z.nativeEnum(MediaSource),
					page: zx.IntAsString.default("1"),
					query: z.string().optional(),
					isTmdbCompany: zx.BoolAsString.optional(),
					isAnilistStudio: zx.BoolAsString.optional(),
				}),
			);
			const { peopleSearch } = await gqlClient.request(
				PeopleSearchDocument,
				{
					input: {
						source: query.source,
						search: { page: query.page, query: query.query },
						sourceSpecifics: {
							isAnilistStudio: query.isAnilistStudio,
							isTmdbCompany: query.isTmdbCompany,
						},
					},
				},
				await getAuthorizationHeader(request),
			);
			return [undefined, { search: peopleSearch, url: query }] as const;
		})
		.exhaustive();
	return json({
		coreDetails: { pageLimit: coreDetails.pageLimit },
		peopleList,
		peopleSearch,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "People | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const [_, { setP }] = useSearchParam();
	const [
		filtersModalOpened,
		{ open: openFiltersModal, close: closeFiltersModal },
	] = useDisclosure(false);

	return (
		<Container>
			<Stack>
				<Flex align="center" gap="md">
					<Title>People</Title>
				</Flex>
				<Group wrap="nowrap">
					<DebouncedSearchInput
						placeholder="Search for people"
						initialValue={loaderData.peopleList?.url.query}
					/>
					<ActionIcon
						onClick={openFiltersModal}
						color={
							loaderData.peopleList?.url.orderBy !== defaultFilters.orderBy ||
							loaderData.peopleList?.url.sortBy !== defaultFilters.sortBy
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
									defaultValue={loaderData.peopleList?.url.sortBy}
									onChange={(v) => setP("sortBy", v)}
								/>
								<ActionIcon
									onClick={() => {
										if (
											loaderData.peopleList?.url.orderBy ===
											GraphqlSortOrder.Asc
										)
											setP("orderBy", GraphqlSortOrder.Desc);
										else setP("orderBy", GraphqlSortOrder.Asc);
									}}
								>
									{loaderData.peopleList?.url.orderBy ===
									GraphqlSortOrder.Asc ? (
										<IconSortAscending />
									) : (
										<IconSortDescending />
									)}
								</ActionIcon>
							</Flex>
						</Stack>
					</Modal>
				</Group>
				{(loaderData.peopleList?.list.details.total || 0) > 0 ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.peopleList?.list.details.total}
							</Text>{" "}
							items found
						</Box>
						<ApplicationGrid>
							{loaderData.peopleList?.list.items.map((creator) => (
								<BaseDisplayItem
									name={creator.name}
									bottomLeft={`${creator.mediaCount} items`}
									imageLink={creator.image}
									imagePlaceholder={getInitials(creator.name)}
									key={creator.id}
									href={$path("/media/people/item/:id", { id: creator.id })}
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
							defaultValue={loaderData.peopleList.url.page}
							onChange={(v) => setP("page", v.toString())}
							total={Math.ceil(
								loaderData.peopleList.list.details.total /
									loaderData.coreDetails.pageLimit,
							)}
						/>
					</Center>
				) : null}
			</Stack>
		</Container>
	);
}
