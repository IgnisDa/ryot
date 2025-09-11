import { ActionIcon, Group, ThemeIcon, Tooltip } from "@mantine/core";
import { useInViewport } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	EntityLot,
	MediaLot,
	SeenState,
	UserToMediaReason,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase } from "@ryot/ts-utils";
import {
	IconBackpack,
	IconBookmarks,
	IconPlayerPlay,
	IconRosetteDiscountCheck,
} from "@tabler/icons-react";
import clsx from "clsx";
import { type ReactNode, useMemo } from "react";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import {
	useMetadataDetails,
	useMetadataGroupDetails,
	usePersonDetails,
	useUserMetadataDetails,
	useUserMetadataGroupDetails,
	useUserPersonDetails,
} from "~/lib/shared/hooks";
import { useMetadataProgressUpdate } from "~/lib/state/media";
import { useOnboardingTour } from "~/lib/state/onboarding-tour";
import classes from "~/styles/common.module.css";
import { BaseEntityDisplayItem } from "../common/entity-display";
import { DisplayAverageRatingOverlay } from "./rating-overlay";

export const MetadataDisplayItem = (props: {
	name?: string;
	altName?: string;
	metadataId: string;
	topLeft?: ReactNode;
	topRight?: ReactNode;
	noLeftLabel?: boolean;
	rightLabel?: ReactNode;
	rightLabelLot?: boolean;
	imageClassName?: string;
	rightLabelHistory?: boolean;
	shouldHighlightNameIfInteracted?: boolean;
	bottomRightImageOverlayClassName?: string;
	onImageClickBehavior?: () => Promise<void>;
}) => {
	const { initializeMetadataToUpdate } = useMetadataProgressUpdate();
	const { ref, inViewport } = useInViewport();
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const [
		{ data: metadataDetails, isLoading: isMetadataDetailsLoading },
		isMetadataPartialStatusActive,
	] = useMetadataDetails(props.metadataId, inViewport);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
		inViewport,
	);

	const averageRating = userMetadataDetails?.averageRating;
	const completedHistory = (userMetadataDetails?.history || []).filter(
		(h) => h.state === SeenState.Completed,
	);
	const currentProgress = userMetadataDetails?.history.find(
		(h) => h.state === SeenState.InProgress,
	)?.progress;
	const reasons = userMetadataDetails?.mediaReason?.filter((r) =>
		[
			UserToMediaReason.Finished,
			UserToMediaReason.Watchlist,
			UserToMediaReason.Owned,
		].includes(r),
	);

	const leftLabel = useMemo(() => {
		if (props.noLeftLabel || !metadataDetails || !userMetadataDetails)
			return null;

		const inProgress = userMetadataDetails.inProgress;
		if (inProgress) {
			if (inProgress.podcastExtraInformation)
				return `EP-${inProgress.podcastExtraInformation.episode}`;
			if (inProgress.showExtraInformation)
				return `S${inProgress.showExtraInformation.season}-E${inProgress.showExtraInformation.episode}`;
		}

		const nextEntry = userMetadataDetails.nextEntry;
		if (nextEntry) {
			if (metadataDetails.lot === MediaLot.Show)
				return `S${nextEntry.season}-E${nextEntry.episode}`;
			if (metadataDetails.lot === MediaLot.Podcast)
				return `EP-${nextEntry.episode}`;
		}

		return metadataDetails.publishYear;
	}, [metadataDetails, userMetadataDetails, props.noLeftLabel]);

	const surroundReason = (
		idx: number,
		data: readonly [UserToMediaReason, ReactNode],
	) => (
		<Tooltip label={changeCase(data[0])} key={idx}>
			<ThemeIcon variant="transparent" size="sm" color="cyan">
				{data[1]}
			</ThemeIcon>
		</Tooltip>
	);

	const images = [
		...(metadataDetails?.assets.remoteImages || []),
		...(metadataDetails?.assets.s3Images || []),
	];

	return (
		<BaseEntityDisplayItem
			innerRef={ref}
			imageUrl={images.at(0)}
			altName={props.altName}
			progress={currentProgress}
			imageClassName={props.imageClassName}
			name={props.name ?? metadataDetails?.title}
			isDetailsLoading={isMetadataDetailsLoading}
			isPartialStatusActive={isMetadataPartialStatusActive}
			highlightImage={userMetadataDetails?.isRecentlyConsumed}
			highlightName={
				props.shouldHighlightNameIfInteracted &&
				userMetadataDetails?.hasInteracted
			}
			onImageClickBehavior={[
				$path("/media/item/:id", { id: props.metadataId }),
				props.onImageClickBehavior,
			]}
			labels={
				metadataDetails
					? {
							left: leftLabel,
							right:
								props.rightLabel ||
								(props.rightLabelLot
									? changeCase(snakeCase(metadataDetails.lot))
									: undefined) ||
								(props.rightLabelHistory
									? completedHistory.length > 0
										? `${completedHistory.length} time${completedHistory.length === 1 ? "" : "s"}`
										: null
									: changeCase(snakeCase(metadataDetails.lot))),
						}
					: undefined
			}
			imageOverlay={{
				topLeft: props.topLeft,
				topRight: props.topRight || (
					<DisplayAverageRatingOverlay
						entityId={props.metadataId}
						averageRating={averageRating}
						entityLot={EntityLot.Metadata}
						metadataLot={metadataDetails?.lot}
						entityTitle={metadataDetails?.title}
					/>
				),
				bottomLeft:
					reasons && reasons.length > 0 ? (
						<Group gap={3}>
							{reasons
								.map((r) =>
									match(r)
										.with(
											UserToMediaReason.Finished,
											() => [r, <IconRosetteDiscountCheck key={r} />] as const,
										)
										.with(
											UserToMediaReason.Watchlist,
											() => [r, <IconBookmarks key={r} />] as const,
										)
										.with(
											UserToMediaReason.Owned,
											() => [r, <IconBackpack key={r} />] as const,
										)
										.run(),
								)
								.map((data, idx) => surroundReason(idx, data))}
						</Group>
					) : null,
				bottomRight: (
					<ActionIcon
						color="blue"
						size="compact-md"
						variant="transparent"
						className={props.bottomRightImageOverlayClassName}
						onClick={async () => {
							if (isMetadataDetailsLoading || isMetadataPartialStatusActive) {
								notifications.show({
									color: "yellow",
									title: "Please wait",
									message: "Details are still loading",
								});
								return;
							}

							initializeMetadataToUpdate(
								{ metadataId: props.metadataId },
								true,
							);

							if (props.bottomRightImageOverlayClassName) {
								advanceOnboardingTourStep();
							}
						}}
					>
						<IconPlayerPlay
							size={20}
							className={clsx({
								[classes.fadeInOut]: isMetadataPartialStatusActive,
							})}
						/>
					</ActionIcon>
				),
			}}
		/>
	);
};

export const MetadataGroupDisplayItem = (props: {
	topLeft?: ReactNode;
	topRight?: ReactNode;
	noLeftLabel?: boolean;
	rightLabel?: ReactNode;
	metadataGroupId: string;
	shouldHighlightNameIfInteracted?: boolean;
}) => {
	const { ref, inViewport } = useInViewport();
	const [
		{ data: metadataDetails, isLoading: isMetadataGroupDetailsLoading },
		isMetadataGroupPartialStatusActive,
	] = useMetadataGroupDetails(props.metadataGroupId, inViewport);
	const { data: userMetadataGroupDetails } = useUserMetadataGroupDetails(
		props.metadataGroupId,
		inViewport,
	);

	const averageRating = userMetadataGroupDetails?.averageRating;

	return (
		<BaseEntityDisplayItem
			innerRef={ref}
			name={metadataDetails?.details.title}
			isDetailsLoading={isMetadataGroupDetailsLoading}
			isPartialStatusActive={isMetadataGroupPartialStatusActive}
			imageUrl={metadataDetails?.details.assets.remoteImages.at(0)}
			highlightImage={userMetadataGroupDetails?.isRecentlyConsumed}
			onImageClickBehavior={[
				$path("/media/groups/item/:id", { id: props.metadataGroupId }),
			]}
			highlightName={
				props.shouldHighlightNameIfInteracted &&
				userMetadataGroupDetails?.hasInteracted
			}
			imageOverlay={{
				topLeft: props.topLeft,
				topRight: props.topRight || (
					<DisplayAverageRatingOverlay
						averageRating={averageRating}
						entityId={props.metadataGroupId}
						entityLot={EntityLot.MetadataGroup}
						entityTitle={metadataDetails?.details.title}
					/>
				),
			}}
			labels={
				metadataDetails
					? {
							left:
								props.noLeftLabel !== true
									? `${metadataDetails.details.parts} items`
									: undefined,
							right:
								props.rightLabel ||
								changeCase(snakeCase(metadataDetails.details.lot)),
						}
					: undefined
			}
		/>
	);
};

export const PersonDisplayItem = (props: {
	personId: string;
	topLeft?: ReactNode;
	topRight?: ReactNode;
	rightLabel?: ReactNode;
	shouldHighlightNameIfInteracted?: boolean;
}) => {
	const { ref, inViewport } = useInViewport();
	const [
		{ data: personDetails, isLoading: isPersonDetailsLoading },
		isPersonPartialStatusActive,
	] = usePersonDetails(props.personId, inViewport);
	const { data: userPersonDetails } = useUserPersonDetails(
		props.personId,
		inViewport,
	);

	const averageRating = userPersonDetails?.averageRating;

	return (
		<BaseEntityDisplayItem
			innerRef={ref}
			name={personDetails?.details.name}
			isDetailsLoading={isPersonDetailsLoading}
			isPartialStatusActive={isPersonPartialStatusActive}
			highlightImage={userPersonDetails?.isRecentlyConsumed}
			imageUrl={personDetails?.details.assets.remoteImages.at(0)}
			onImageClickBehavior={[
				$path("/media/people/item/:id", { id: props.personId }),
			]}
			highlightName={
				props.shouldHighlightNameIfInteracted &&
				userPersonDetails?.hasInteracted
			}
			imageOverlay={{
				topLeft: props.topLeft,
				topRight: props.topRight || (
					<DisplayAverageRatingOverlay
						entityId={props.personId}
						entityLot={EntityLot.Person}
						averageRating={averageRating}
						entityTitle={personDetails?.details.name}
					/>
				),
			}}
			labels={{
				right: props.rightLabel,
				left: personDetails
					? `${personDetails.details.associatedEntityCount} items`
					: undefined,
			}}
		/>
	);
};
