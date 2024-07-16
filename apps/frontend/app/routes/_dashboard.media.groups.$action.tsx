import { $path } from "@ignisda/remix-routes";
import {
	Box,
	Center,
	Container,
	Group,
	Loader,
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
	type MetadataGroupSearchQuery,
	MetadataGroupsListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, startCase } from "@ryot/ts-utils";
import { IconListCheck, IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { withoutHost } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { ApplicationGrid, DebouncedSearchInput } from "~/components/common";
import {
	BaseMediaDisplayItem,
	MetadataGroupDisplayItem,
} from "~/components/media";
import { redirectToQueryParam } from "~/lib/generals";
import { useAppSearchParam, useCoreDetails } from "~/lib/hooks";
import {
	enhancedServerGqlService,
	getAuthorizationHeader,
	getEnhancedCookieName,
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
	const { action } = zx.parseParams(params, { action: z.nativeEnum(Action) });
	const cookieName = await getEnhancedCookieName(`groups.${action}`, request);
	const { query, page } = zx.parseQuery(request, {
		query: z.string().optional(),
		page: zx.IntAsString.default("1"),
	});
	const [list, search] = await match(action)
		.with(Action.List, async () => {
			const { metadataGroupsList } = await enhancedServerGqlService.request(
				MetadataGroupsListDocument,
				{ input: { page, query } },
				getAuthorizationHeader(request),
			);
			return [{ list: metadataGroupsList, url: {} }, undefined] as const;
		})
		.with(Action.Search, async () => {
			const urlParse = zx.parseQuery(request, {
				source: z.nativeEnum(MediaSource).default(MediaSource.Tmdb),
			});
			const lot = SEARCH_SOURCES_ALLOWED[urlParse.source];
			invariant(lot);
			const { metadataGroupSearch } = await enhancedServerGqlService.request(
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
	return { action, query, page, list, search, cookieName };
});

export const meta = ({ params }: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: `${changeCase(params.action || "")} Groups | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const coreDetails = useCoreDetails();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);
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
						enhancedQueryParams={loaderData.cookieName}
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
									{loaderData.list.list.items.map((gr) => (
										<MetadataGroupDisplayItem key={gr} metadataGroupId={gr} />
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
										<GroupSearchItem item={group} key={group.identifier} />
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
	item: MetadataGroupSearchQuery["metadataGroupSearch"]["items"][number];
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const [isLoading, setIsLoading] = useState(false);

	return (
		<BaseMediaDisplayItem
			isLoading={false}
			name={props.item.name}
			imageUrl={props.item.image}
			imageOverlay={{
				topLeft: isLoading ? (
					<Loader color="red" variant="bars" size="sm" m={2} />
				) : null,
			}}
			labels={{
				left: props.item.parts ? `${props.item.parts} items` : undefined,
			}}
			onImageClickBehavior={async () => {
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
