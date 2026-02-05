import { Button, SimpleGrid } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	CollectionContentsSortBy,
	EntityLot,
	GraphqlSortOrder,
	MediaLot,
} from "@ryot/generated/graphql/backend/graphql";
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import type {
	CollectionContents,
	FilterState,
} from "~/components/routes/collections/filters-state";
import { useCoreDetails } from "~/lib/shared/hooks";
import type { useBulkEditCollection } from "~/lib/state/collection";
import type { useReviewEntity } from "~/lib/state/media";

export type ActionsTabPanelProps = {
	collectionId: string;
	contentsTabValue: string;
	isReorderMode: boolean;
	resetFilters: () => void;
	setTab: (tab: string | null) => void;
	details: NonNullable<CollectionContents>;
	setIsReorderMode: (value: boolean) => void;
	updateFilters: (filters: Partial<FilterState>) => void;
	setEntityToReview: ReturnType<typeof useReviewEntity>[1];
	bulkEditingCollection: ReturnType<typeof useBulkEditCollection>;
	colDetails: { id: string; name: string; creatorUserId: string } | null;
};

export function ActionsTabPanel(props: ActionsTabPanelProps) {
	const navigate = useNavigate();
	const coreDetails = useCoreDetails();

	return (
		<SimpleGrid cols={{ base: 2, md: 3, lg: 4 }} spacing="lg">
			<Button
				w="100%"
				variant="outline"
				onClick={() => {
					props.setEntityToReview({
						entityLot: EntityLot.Collection,
						entityId: props.collectionId,
						entityTitle: props.details.details.name,
					});
				}}
			>
				Post a review
			</Button>
			<Button
				w="100%"
				variant="outline"
				onClick={() => {
					if (!props.colDetails) return;
					props.bulkEditingCollection.start(props.colDetails, "add");
					navigate(
						$path("/media/:action/:lot", {
							action: "list",
							lot: MediaLot.Movie.toLowerCase(),
						}),
					);
				}}
			>
				Bulk add
			</Button>
			<Button
				w="100%"
				variant="outline"
				disabled={props.details.results.details.totalItems === 0}
				onClick={() => {
					if (!props.colDetails) return;
					props.bulkEditingCollection.start(props.colDetails, "remove");
					props.setTab(props.contentsTabValue);
				}}
			>
				Bulk remove
			</Button>
			<Button
				w="100%"
				variant="outline"
				disabled={props.details.results.details.totalItems === 0}
				onClick={() => {
					if (props.isReorderMode) {
						props.setIsReorderMode(false);
						return;
					}
					if (!coreDetails.isServerKeyValidated) {
						notifications.show({
							color: "red",
							title: "Pro Required",
							message: "Collection reordering requires a validated server key.",
						});
						return;
					}
					props.resetFilters();
					props.updateFilters({
						orderBy: GraphqlSortOrder.Asc,
						sortBy: CollectionContentsSortBy.Rank,
					});
					props.setTab(props.contentsTabValue);
					props.setIsReorderMode(true);
				}}
			>
				{props.isReorderMode ? "Exit Reorder Mode" : "Reorder items"}
			</Button>
		</SimpleGrid>
	);
}
