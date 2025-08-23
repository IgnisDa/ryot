import { Box, Container, Group, Stack, Text, Title } from "@mantine/core";
import { GenreDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import invariant from "tiny-invariant";
import { useLocalStorage } from "usehooks-ts";
import { ApplicationPagination, SkeletonLoader } from "~/components/common";
import { ApplicationGrid } from "~/components/common/layout";
import { MetadataDisplayItem } from "~/components/media/display-items";
import { clientGqlService, queryFactory } from "~/lib/shared/react-query";

interface PaginationState {
	page: number;
}

const defaultPaginationState: PaginationState = {
	page: 1,
};

export const meta = () => {
	return [{ title: "Genre | Ryot" }];
};

export default function Page() {
	const params = useParams();
	const genreId = params.id;

	invariant(genreId);

	const [pagination, setPagination] = useLocalStorage(
		`GenrePagination_${genreId}`,
		defaultPaginationState,
	);

	const { data: genreDetails } = useQuery({
		queryKey: queryFactory.media.genreDetails({
			genreId,
			page: pagination.page,
		}).queryKey,
		queryFn: () =>
			clientGqlService
				.request(GenreDetailsDocument, {
					input: { genreId, page: pagination.page },
				})
				.then((data) => data.genreDetails),
	});

	const updatePage = (page: number) =>
		setPagination((prev) => ({ ...prev, page }));

	return (
		<Container>
			<Stack>
				{genreDetails ? (
					<>
						<Group justify="space-between">
							<Box>
								<Title id="genre-title">{genreDetails.details.name}</Title>
								<Text>{genreDetails.details.numItems} media items</Text>
							</Box>
							<ApplicationPagination
								total={genreDetails.contents.details.total}
								value={pagination.page}
								onChange={updatePage}
							/>
						</Group>
						<ApplicationGrid>
							{genreDetails.contents.items.map((media) => (
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
