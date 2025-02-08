import { Box, Container, Group, Stack, Text, Title } from "@mantine/core";
import { GenreDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import { parseAsInteger } from "nuqs";
import invariant from "tiny-invariant";
import { ApplicationPagination, SkeletonLoader } from "~/components/common";
import { ApplicationGrid } from "~/components/common/layout";
import { MetadataDisplayItem } from "~/components/media/display-items";
import { useFiltersState } from "~/lib/hooks/filters/use-state";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";

const defaultPaginationState = {
	page: parseAsInteger.withDefault(1),
};

export const meta = () => {
	return [{ title: "Genre | Ryot" }];
};

export default function Page(props: { params: { id: string } }) {
	const { id: genreId } = props.params;
	invariant(genreId);

	const { filters: pagination, updateFilters } = useFiltersState(
		defaultPaginationState,
	);

	const { data: genreDetails } = useQuery({
		queryKey: queryFactory.media.genreDetails({
			genreId,
			search: { page: pagination.page },
		}).queryKey,
		queryFn: () =>
			clientGqlService
				.request(GenreDetailsDocument, {
					input: { genreId, search: { page: pagination.page } },
				})
				.then((data) => data.genreDetails),
	});

	return (
		<Container>
			<Stack>
				{genreDetails ? (
					<>
						<Group justify="space-between">
							<Box>
								<Title id="genre-title">
									{genreDetails.response.details.name}
								</Title>
								<Text>
									{genreDetails.response.details.numItems} media items
								</Text>
							</Box>
							<ApplicationPagination
								value={pagination.page}
								totalItems={genreDetails.response.contents.details.totalItems}
								onChange={(page) => updateFilters({ page })}
							/>
						</Group>
						<ApplicationGrid>
							{genreDetails.response.contents.items.map((media) => (
								<MetadataDisplayItem key={media} metadataId={media} />
							))}
						</ApplicationGrid>
					</>
				) : (
					<SkeletonLoader />
				)}
			</Stack>
		</Container>
	);
}
