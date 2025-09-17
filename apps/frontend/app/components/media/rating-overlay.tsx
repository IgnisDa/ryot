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
import {
	convertRatingToUserScale,
	formatRatingForDisplay,
	getRatingUnitSuffix,
} from "~/lib/shared/media-utils";
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

	const averageRatingValue = convertRatingToUserScale(
		props.averageRating,
		userPreferences.general.reviewScale,
	);

	const scale = userPreferences.general.reviewScale;
	const ratingSuffix = getRatingUnitSuffix(scale);
	const formattedRating =
		averageRatingValue == null
			? null
			: formatRatingForDisplay(averageRatingValue, scale);

	return formattedRating != null ? (
		match(scale)
			.with(UserReviewScale.ThreePointSmiley, () => (
				<DisplayThreePointReview rating={averageRatingValue} />
			))
			.otherwise(() => (
				<Group gap={4}>
					<IconStarFilled size={12} style={{ color: reviewYellow }} />
					<Text c="white" size="xs" fw="bold" pr={4}>
						{formattedRating}
						{ratingSuffix}
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
