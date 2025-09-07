import { Group, Text } from "@mantine/core";
import {
	type EntityLot,
	type MediaLot,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { IconStarFilled } from "@tabler/icons-react";
import { match } from "ts-pattern";
import { reviewYellow } from "~/lib/shared/constants";
import { useUserPreferences } from "~/lib/shared/hooks";
import { useReviewEntity } from "~/lib/state/media";
import classes from "~/styles/common.module.css";
import { DisplayThreePointReview } from "../common/review";

export const DisplayAverageRatingOverlay = (props: {
	entityId: string;
	entityLot: EntityLot;
	entityTitle?: string;
	metadataLot?: MediaLot;
	averageRating?: string | null;
}) => {
	const userPreferences = useUserPreferences();
	const [_r, setEntityToReview] = useReviewEntity();

	return props.averageRating ? (
		match(userPreferences.general.reviewScale)
			.with(UserReviewScale.ThreePointSmiley, () => (
				<DisplayThreePointReview rating={props.averageRating} />
			))
			.otherwise(() => (
				<Group gap={4}>
					<IconStarFilled size={12} style={{ color: reviewYellow }} />
					<Text c="white" size="xs" fw="bold" pr={4}>
						{Number(props.averageRating) % 1 === 0
							? Math.round(Number(props.averageRating)).toString()
							: Number(props.averageRating).toFixed(1)}
						{userPreferences.general.reviewScale ===
						UserReviewScale.OutOfHundred
							? "%"
							: undefined}
						{userPreferences.general.reviewScale === UserReviewScale.OutOfTen
							? "/10"
							: undefined}
					</Text>
				</Group>
			))
	) : (
		<IconStarFilled
			size={18}
			cursor="pointer"
			className={classes.starIcon}
			onClick={() => {
				if (props.entityTitle)
					setEntityToReview({
						entityId: props.entityId,
						entityLot: props.entityLot,
						entityTitle: props.entityTitle,
						metadataLot: props.metadataLot,
					});
			}}
		/>
	);
};
