import { Stack, Text } from "@mantine/core";
import { EntityLot } from "@ryot/generated/graphql/backend/graphql";
import { ReviewItemDisplay } from "~/components/common/review";
import type { CollectionContents } from "~/components/routes/collections/filters-state";

export type ReviewsTabPanelProps = {
	collectionId: string;
	details: NonNullable<CollectionContents>;
};

export function ReviewsTabPanel(props: ReviewsTabPanelProps) {
	return props.details.reviews.length > 0 ? (
		<Stack>
			{props.details.reviews.map((r) => (
				<ReviewItemDisplay
					review={r}
					key={r.id}
					entityId={props.collectionId}
					entityLot={EntityLot.Collection}
					title={props.details.details.name}
				/>
			))}
		</Stack>
	) : (
		<Text>No reviews</Text>
	);
}
