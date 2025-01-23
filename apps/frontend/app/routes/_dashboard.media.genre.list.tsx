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
	Skeleton,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useInViewport } from "@mantine/hooks";
import type { LoaderFunctionArgs, MetaArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
	GenreDetailsDocument,
	GenresListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getInitials,
	isString,
	truncate,
	zodIntAsString,
} from "@ryot/ts-utils";
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
	query: z.string().optional(),
	[pageQueryParam]: zodIntAsString.default("1"),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
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
};

export const meta = (_args: MetaArgs<typeof loader>) => {
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
				const { image } = await queryClient.ensureQueryData(
					getPartialMetadataDetailsQuery(content),
				);
				if (isString(image)) images.push(image);
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
