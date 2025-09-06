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
	UserGenresListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { getInitials, truncate } from "@ryot/ts-utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { useLocalStorage } from "usehooks-ts";
import {
	ApplicationPagination,
	ProRequiredAlert,
	SkeletonLoader,
} from "~/components/common";
import { DebouncedSearchInput } from "~/components/common/filters";
import { ApplicationGrid } from "~/components/common/layout";
import {
	useCoreDetails,
	useFallbackImageUrl,
	useGetRandomMantineColor,
} from "~/lib/shared/hooks";
import {
	clientGqlService,
	getMetadataDetailsQuery,
	queryClient,
	queryFactory,
} from "~/lib/shared/react-query";

interface FilterState {
	page: number;
	query: string;
}

const defaultFilterState: FilterState = {
	page: 1,
	query: "",
};

export const meta = () => {
	return [{ title: "Genres | Ryot" }];
};

export default function Page() {
	const [filters, setFilters] = useLocalStorage(
		"GenreListFilters",
		defaultFilterState,
	);

	const { data: userGenresList } = useQuery({
		queryKey: queryFactory.media.userGenresList({
			page: filters.page,
			query: filters.query,
		}).queryKey,
		queryFn: () =>
			clientGqlService
				.request(UserGenresListDocument, {
					input: { page: filters.page, query: filters.query },
				})
				.then((data) => data.userGenresList),
	});

	const updateFilter = (
		key: keyof FilterState,
		value: string | number | null,
	) => setFilters((prev) => ({ ...prev, [key]: value }));

	return (
		<Container>
			<Stack>
				{userGenresList ? (
					<>
						<Group justify="space-between">
							<Title>Genres</Title>
							<ApplicationPagination
								value={filters.page}
								onChange={(v) => updateFilter("page", v)}
								totalItems={userGenresList.details.totalItems}
							/>
						</Group>
						<DebouncedSearchInput
							value={filters.query}
							placeholder="Search for genres"
							onChange={(value) => {
								updateFilter("query", value);
								updateFilter("page", 1);
							}}
						/>
						{userGenresList.details.totalItems > 0 ? (
							<>
								<Box>
									<Text display="inline" fw="bold">
										{userGenresList.details.totalItems}
									</Text>{" "}
									items found
								</Box>
								<ApplicationGrid>
									{userGenresList.items.map((genreId) => (
										<DisplayGenre key={genreId} genreId={genreId} />
									))}
								</ApplicationGrid>
							</>
						) : (
							<Text>No information to display</Text>
						)}
					</>
				) : (
					<SkeletonLoader />
				)}
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

			const images = [];
			const maxImages = 4;
			const batchSize = 6;

			const contentsBatch = genreDetails.response.contents.items.slice(
				0,
				batchSize,
			);

			const results = await Promise.all(
				contentsBatch.map(async (content) => {
					const { assets } = await queryClient.ensureQueryData(
						getMetadataDetailsQuery(content),
					);
					return assets.remoteImages.length > 0 ? assets.remoteImages[0] : null;
				}),
			);

			for (const image of results)
				if (image && images.length <= maxImages) images.push(image);

			if (images.length <= maxImages)
				return { genreDetails, images: images.slice(0, 1) };

			return { genreDetails, images };
		},
	});

	const genreName = genreData?.genreDetails.response.details.name || "";
	const color = useGetRandomMantineColor(genreName);
	const fallbackImageUrl = useFallbackImageUrl(getInitials(genreName));

	if (!genreData) return <Skeleton height={290} ref={ref} />;

	return (
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
	);
};
