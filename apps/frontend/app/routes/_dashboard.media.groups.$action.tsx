import { $path } from "@ignisda/remix-routes";
import {
	Box,
	Center,
	Container,
	Group,
	Pagination,
	Select,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { unstable_defineLoader } from "@remix-run/node";
import {
	type MetaArgs_SingleFetch,
	useLoaderData,
	useNavigate,
} from "@remix-run/react";
import {
	MediaLot,
	MediaSource,
	MetadataGroupSearchDocument,
	MetadataGroupsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials, snakeCase, startCase } from "@ryot/ts-utils";
import { IconListCheck, IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withoutHost } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, DebouncedSearchInput } from "~/components/common";
import {
	BaseDisplayItem,
	type Item,
	MediaItemWithoutUpdateModal,
} from "~/components/media";
import { redirectToQueryParam } from "~/lib/generals";
import {
	useCoreDetails,
	useSearchParam,
	useUserPreferences,
} from "~/lib/hooks";
import {
	getAuthorizationHeader,
	serverGqlService,
} from "~/lib/utilities.server";

export type SearchParams = {
	query?: string;
};

enum Action {
	List = "list",
	Search = "search",
}

const SEARCH_SOURCES_ALLOWED: Partial<Record<MediaSource, MediaLot>> = {
	[MediaSource.Tmdb]: MediaLot.Movie,
	[MediaSource.Igdb]: MediaLot.VideoGame,
};

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const action = params.action as Action;
	const { query, page } = zx.parseQuery(request, {
		query: z.string().optional(),
		page: zx.IntAsString.default("1"),
	});
	const [list, search] = await match(action)
		.with(Action.List, async () => {
			const { metadataGroupsList } = await serverGqlService.request(
				MetadataGroupsListDocument,
				{ input: { page, query } },
				getAuthorizationHeader(request),
			);
			return [{ list: metadataGroupsList, url: {} }, undefined] as const;
		})
		.with(Action.Search, async () => {
			const urlParse = zx.parseQuery(
				request,
				z.object({
					source: z.nativeEnum(MediaSource).default(MediaSource.Tmdb),
				}),
			);
			const lot = SEARCH_SOURCES_ALLOWED[urlParse.source];
			invariant(lot);
			const { metadataGroupSearch } = await serverGqlService.request(
				MetadataGroupSearchDocument,
				{ input: { lot, source: urlParse.source, search: { page, query } } },
				getAuthorizationHeader(request),
			);
			return [
				undefined,
				{ search: metadataGroupSearch, url: urlParse, lot },
			] as const;
		})
		.exhaustive();
	return { action, query, page, list, search };
});

export const meta = ({ params }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${changeCase(params.action || "")} Groups | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const [_, { setP }] = useSearchParam();
	const navigate = useNavigate();

	return (
		<Container>
			<Stack>
				<Title>Groups</Title>
				<Tabs
					variant="default"
					value={loaderData.action}
					onChange={(v) => {
						if (v)
							navigate(
								$path(
									"/media/groups/:action",
									{ action: v },
									{ query: loaderData.query },
								),
							);
					}}
				>
					<Tabs.List style={{ alignItems: "center" }}>
						<Tabs.Tab value="list" leftSection={<IconListCheck size={24} />}>
							<Text>My Groups</Text>
						</Tabs.Tab>
						<Tabs.Tab value="search" leftSection={<IconSearch size={24} />}>
							<Text>Search</Text>
						</Tabs.Tab>
					</Tabs.List>
				</Tabs>

				<Group wrap="nowrap">
					<DebouncedSearchInput
						placeholder="Search for groups"
						initialValue={loaderData.query}
					/>
					{loaderData.action === Action.Search ? (
						<>
							<Select
								data={Object.keys(SEARCH_SOURCES_ALLOWED).map((o) => ({
									value: o.toString(),
									label: startCase(o.toLowerCase()),
								}))}
								defaultValue={loaderData.search?.url.source}
								onChange={(v) => setP("source", v)}
							/>
						</>
					) : null}
				</Group>

				{loaderData.list ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.list.list.details.total}
							</Text>{" "}
							items found
						</Box>
						{loaderData.list.list.details.total > 0 ? (
							<>
								<ApplicationGrid>
									{loaderData.list.list.items.map((group) => (
										<BaseDisplayItem
											name={group.title}
											bottomLeft={`${group.parts} items`}
											bottomRight={changeCase(snakeCase(group.lot))}
											imageLink={group.image}
											imagePlaceholder={getInitials(group.title)}
											key={group.id}
											href={$path("/media/groups/item/:id", { id: group.id })}
										/>
									))}
								</ApplicationGrid>
								<Center>
									<Pagination
										size="sm"
										value={loaderData.page}
										onChange={(v) => setP("page", v.toString())}
										total={Math.ceil(
											loaderData.list.list.details.total /
												coreDetails.pageLimit,
										)}
									/>
								</Center>
							</>
						) : (
							<Text>No information to display</Text>
						)}
					</>
				) : null}

				{loaderData.search ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.search.search.details.total}
							</Text>{" "}
							items found
						</Box>
						{loaderData.search.search.details.total > 0 ? (
							<>
								<ApplicationGrid>
									{loaderData.search.search.items.map((group) => (
										<GroupSearchItem
											item={{
												...group,
												title: group.name,
												publishYear: group.parts ? `${group.parts} items` : "",
											}}
											key={group.identifier}
										/>
									))}
								</ApplicationGrid>
								<Center>
									<Pagination
										size="sm"
										value={loaderData.page}
										onChange={(v) => setP("page", v.toString())}
										total={Math.ceil(
											loaderData.search.search.details.total /
												coreDetails.pageLimit,
										)}
									/>
								</Center>
							</>
						) : (
							<Text>No groups found matching your query</Text>
						)}
					</>
				) : null}
			</Stack>
		</Container>
	);
}

const GroupSearchItem = (props: {
	item: Item;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const navigate = useNavigate();
	const [isLoading, setIsLoading] = useState(false);

	return (
		<MediaItemWithoutUpdateModal
			item={props.item}
			noHref
			reviewScale={userPreferences.general.reviewScale}
			imageOverlayForLoadingIndicator={isLoading}
			onClick={async (_) => {
				if (loaderData.search) {
					setIsLoading(true);
					const id = await commitGroup(
						props.item.identifier,
						loaderData.search.url.source,
						loaderData.search.lot,
					);
					setIsLoading(false);
					return navigate($path("/media/groups/item/:id", { id }));
				}
			}}
		/>
	);
};

const commitGroup = async (
	identifier: string,
	source: MediaSource,
	lot: MediaLot,
) => {
	const data = new FormData();
	const location = withoutHost(window.location.href);
	data.append("identifier", identifier);
	data.append("source", source);
	data.append("lot", lot);
	data.append(redirectToQueryParam, location);
	const resp = await fetch(
		$path("/actions", { intent: "commitMetadataGroup" }),
		{ method: "POST", body: data },
	);
	const json = await resp.json();
	return json.commitMetadataGroup.id;
};
