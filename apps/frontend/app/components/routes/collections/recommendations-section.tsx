import { Stack, Text } from "@mantine/core";
import {
	CollectionRecommendationsDocument,
	type CollectionRecommendationsInput,
} from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import { parseAsInteger, parseAsString } from "nuqs";
import { ApplicationPagination, SkeletonLoader } from "~/components/common";
import { DebouncedSearchInput } from "~/components/common/filters";
import { ApplicationGrid } from "~/components/common/layout";
import { MetadataDisplayItem } from "~/components/media/display-items";
import { useFiltersState } from "~/lib/hooks/filters/use-state";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";

const defaultRecommendationsState = {
	recommendationsPage: parseAsInteger.withDefault(1),
	recommendationsQuery: parseAsString.withDefault(""),
};

export const RecommendationsSection = (props: { collectionId: string }) => {
	const { filters: search, updateFilters } = useFiltersState(
		defaultRecommendationsState,
	);

	const input: CollectionRecommendationsInput = {
		collectionId: props.collectionId,
		search: {
			page: search.recommendationsPage,
			query: search.recommendationsQuery,
		},
	};

	const { data: recommendations } = useQuery({
		queryKey:
			queryFactory.collections.collectionRecommendations(input).queryKey,
		queryFn: () =>
			clientGqlService.request(CollectionRecommendationsDocument, { input }),
	});

	return (
		<Stack gap="xs">
			<DebouncedSearchInput
				value={search.recommendationsQuery}
				placeholder="Search recommendations"
				onChange={(query) =>
					updateFilters({ recommendationsPage: 1, recommendationsQuery: query })
				}
			/>
			{recommendations ? (
				recommendations.collectionRecommendations.details.totalItems > 0 ? (
					<>
						<ApplicationGrid>
							{recommendations.collectionRecommendations.items.map((r) => (
								<MetadataDisplayItem
									key={r}
									metadataId={r}
									shouldHighlightNameIfInteracted
								/>
							))}
						</ApplicationGrid>
						<ApplicationPagination
							value={search.recommendationsPage}
							onChange={(page) => updateFilters({ recommendationsPage: page })}
							totalItems={
								recommendations.collectionRecommendations.details.totalItems
							}
						/>
					</>
				) : (
					<Text>No recommendations found</Text>
				)
			) : (
				<SkeletonLoader />
			)}
		</Stack>
	);
};
