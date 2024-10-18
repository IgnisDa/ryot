import {
	Anchor,
	Box,
	Center,
	Container,
	Flex,
	Group,
	Image,
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
import {
	GenreDetailsDocument,
	GenresListDocument,
	type GenresListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { getInitials, isString, truncate } from "@ryot/ts-utils";
import { useQuery } from "@tanstack/react-query";
import { $path } from "remix-routes";
import { z } from "zod";
import { zx } from "zodix";
import {
	ApplicationGrid,
	DebouncedSearchInput,
	ProRequiredAlert,
} from "~/components/common";
import {
	clientGqlService,
	dayjsLib,
	getPartialMetadataDetailsQuery,
	queryClient,
	queryFactory,
} from "~/lib/generals";
import { pageQueryParam } from "~/lib/generals";
import {
	useAppSearchParam,
	useCoreDetails,
	useFallbackImageUrl,
	useGetRandomMantineColor,
} from "~/lib/hooks";
import {
	getEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	[pageQueryParam]: zx.IntAsString.default("1"),
	query: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request }) => {
	const cookieName = await getEnhancedCookieName("genre.list", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = zx.parseQuery(request, searchParamsSchema);
	const [{ genresList }] = await Promise.all([
		serverGqlService.request(GenresListDocument, {
			input: { page: query[pageQueryParam], query: query.query },
		}),
	]);
	const totalPages = await redirectToFirstPageIfOnInvalidPage(
		request,
		genresList.details.total,
		query[pageQueryParam],
	);
	return { query, genresList, cookieName, totalPages };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Genres | Ryot" }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [_, { setP }] = useAppSearchParam(loaderData.cookieName);

	return (
		<Container>
			<Stack>
				<Flex align="center" gap="md">
					<Title>Genres</Title>
				</Flex>
				<DebouncedSearchInput
					placeholder="Search for genres"
					initialValue={loaderData.query.query}
					enhancedQueryParams={loaderData.cookieName}
				/>
				{loaderData.genresList.details.total > 0 ? (
					<>
						<Box>
							<Text display="inline" fw="bold">
								{loaderData.genresList.details.total}
							</Text>{" "}
							items found
						</Box>
						<ApplicationGrid>
							{loaderData.genresList.items.map((genre) => (
								<DisplayGenre key={genre.id} genre={genre} />
							))}
						</ApplicationGrid>
					</>
				) : (
					<Text>No information to display</Text>
				)}
				{loaderData.genresList ? (
					<Center mt="xl">
						<Pagination
							size="sm"
							total={loaderData.totalPages}
							value={loaderData.query[pageQueryParam]}
							onChange={(v) => setP(pageQueryParam, v.toString())}
						/>
					</Center>
				) : null}
			</Stack>
		</Container>
	);
}

type Genre = GenresListQuery["genresList"]["items"][number];

const DisplayGenre = (props: { genre: Genre }) => {
	const coreDetails = useCoreDetails();
	const color = useGetRandomMantineColor(props.genre.name);
	const fallbackImageUrl = useFallbackImageUrl(getInitials(props.genre.name));
	const { data: genreImages } = useQuery({
		queryKey: queryFactory.media.genreImages(props.genre.id).queryKey,
		queryFn: async () => {
			const { genreDetails } = await clientGqlService.request(
				GenreDetailsDocument,
				{ input: { genreId: props.genre.id } },
			);
			let images = [];
			for (const content of genreDetails.contents.items) {
				if (images.length === 4) break;
				const { image } = await queryClient.ensureQueryData(
					getPartialMetadataDetailsQuery(content),
				);
				if (isString(image)) images.push(image);
			}
			if (images.length < 4) images = images.splice(0, 1);
			return images;
		},
		staleTime: dayjsLib.duration(1, "hour").asMilliseconds(),
	});

	return (
		<Anchor
			component={Link}
			to={$path("/media/genre/:id", { id: props.genre.id })}
		>
			<Stack gap={4}>
				<Box pos="relative">
					{coreDetails.isPro ? (
						<Paper radius="md" style={{ overflow: "hidden" }}>
							<Flex h={260} w={168} wrap="wrap">
								{genreImages?.map((image) => (
									<Image
										h={genreImages.length === 1 ? "auto" : 130}
										w={genreImages.length === 1 ? "auto" : 84}
										key={image}
										src={image}
										alt={props.genre.name}
									/>
								))}
							</Flex>
						</Paper>
					) : (
						<>
							<Image
								radius="md"
								h={260}
								alt={props.genre.name}
								fallbackSrc={fallbackImageUrl}
							/>
							<Box pos="absolute" left={0} right={0} bottom={0}>
								<ProRequiredAlert tooltipLabel="Collage image using genre contents" />
							</Box>
						</>
					)}
				</Box>
				<Group justify="center">
					<Box h={11} w={11} bg={color} style={{ borderRadius: 2 }} />
					<Text>{truncate(props.genre.name, { length: 13 })}</Text>
				</Group>
			</Stack>
		</Anchor>
	);
};
