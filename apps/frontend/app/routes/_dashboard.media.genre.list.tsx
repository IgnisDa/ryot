import {
	Anchor,
	Box,
	Container,
	Flex,
	Group,
	Image,
	Paper,
	Skeleton,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useInViewport } from "@mantine/hooks";
import {
	GenreDetailsDocument,
	GenresListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getInitials,
	parseSearchQuery,
	truncate,
	zodIntAsString,
} from "@ryot/ts-utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useLoaderData } from "react-router";
import { $path } from "safe-routes";
import { z } from "zod";
import { ApplicationPagination, ProRequiredAlert } from "~/components/common";
import { DebouncedSearchInput } from "~/components/common/filters";
import { ApplicationGrid } from "~/components/common/layout";
import { pageQueryParam } from "~/lib/shared/constants";
import {
	useAppSearchParam,
	useCoreDetails,
	useFallbackImageUrl,
	useGetRandomMantineColor,
} from "~/lib/shared/hooks";
import {
	clientGqlService,
	getMetadataDetailsQuery,
	queryClient,
	queryFactory,
} from "~/lib/shared/query-factory";
import {
	getSearchEnhancedCookieName,
	redirectToFirstPageIfOnInvalidPage,
	redirectUsingEnhancedCookieSearchParams,
	serverGqlService,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_dashboard.media.genre.list";

const searchParamsSchema = z.object({
	query: z.string().optional(),
	[pageQueryParam]: zodIntAsString.default(1),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: Route.LoaderArgs) => {
	const cookieName = await getSearchEnhancedCookieName("genre.list", request);
	await redirectUsingEnhancedCookieSearchParams(request, cookieName);
	const query = parseSearchQuery(request, searchParamsSchema);
	const [{ genresList }] = await Promise.all([
		serverGqlService.authenticatedRequest(request, GenresListDocument, {
			input: { page: query[pageQueryParam], query: query.query },
		}),
	]);
	const totalPages = await redirectToFirstPageIfOnInvalidPage({
		request,
		currentPage: query[pageQueryParam],
		totalResults: genresList.details.total,
	});
	return { query, genresList, cookieName, totalPages };
};

export const meta = () => {
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
							{loaderData.genresList.items.map((genreId) => (
								<DisplayGenre key={genreId} genreId={genreId} />
							))}
						</ApplicationGrid>
					</>
				) : (
					<Text>No information to display</Text>
				)}
				<ApplicationPagination
					total={loaderData.totalPages}
					value={loaderData.query[pageQueryParam]}
					onChange={(v) => setP(pageQueryParam, v.toString())}
				/>
			</Stack>
		</Container>
	);
}

const DisplayGenre = (props: { genreId: string }) => {
	const coreDetails = useCoreDetails();
	const { ref, inViewport } = useInViewport();
	const { data: genreData } = useQuery({
		enabled: inViewport,
		queryKey: queryFactory.media.genreImages(props.genreId).queryKey,
		queryFn: async () => {
			const { genreDetails } = await clientGqlService.request(
				GenreDetailsDocument,
				{ input: { genreId: props.genreId } },
			);
			let images = [];
			for (const content of genreDetails.contents.items) {
				if (images.length === 4) break;
				const { assets } = await queryClient.ensureQueryData(
					getMetadataDetailsQuery(content),
				);
				if (assets.remoteImages.length > 0) images.push(assets.remoteImages[0]);
			}
			if (images.length < 4) images = images.splice(0, 1);
			return { genreDetails, images };
		},
	});

	const genreName = genreData?.genreDetails.details.name || "";
	const color = useGetRandomMantineColor(genreName);
	const fallbackImageUrl = useFallbackImageUrl(getInitials(genreName));

	return genreData ? (
		<Anchor
			component={Link}
			to={$path("/media/genre/:id", { id: props.genreId })}
		>
			<Stack gap={4}>
				<Box pos="relative">
					{coreDetails.isServerKeyValidated ? (
						<Paper radius="md" style={{ overflow: "hidden" }}>
							<Flex h={260} w={168} wrap="wrap">
								{genreData.images.map((image) => (
									<Image
										key={image}
										src={image}
										alt={props.genreId}
										h={genreData.images.length === 1 ? "auto" : 130}
										w={genreData.images.length === 1 ? "auto" : 84}
									/>
								))}
							</Flex>
						</Paper>
					) : (
						<>
							<Image
								h={260}
								radius="md"
								alt={genreName}
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
					<Text>{truncate(genreName, { length: 13 })}</Text>
				</Group>
			</Stack>
		</Anchor>
	) : (
		<Skeleton height={290} ref={ref} />
	);
};
