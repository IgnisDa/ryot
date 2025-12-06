import { useInViewport } from "@mantine/hooks";
import {
	EntityLot,
	MediaLot,
	SeenState,
	UserToMediaReason,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase } from "@ryot/ts-utils";
import { type ReactNode, useMemo } from "react";
import { $path } from "safe-routes";
import {
	useMetadataDetails,
	useMetadataGroupDetails,
	usePersonDetails,
	useS3PresignedUrls,
	useUserEntityRecentlyConsumed,
	useUserMetadataDetails,
	useUserMetadataGroupDetails,
	useUserPersonDetails,
} from "~/lib/shared/hooks";
import { BaseEntityDisplayItem } from "../common/entity-display";

export const MetadataDisplayItem = (props: {
	metadataId: string;
	isFirstItem?: boolean;
	imageClassName?: string;
	centerElement?: ReactNode;
	additionalInformation?: string;
	shouldHighlightNameIfInteracted?: boolean;
	onImageClickBehavior?: () => Promise<void>;
}) => {
	const { ref, inViewport } = useInViewport();

	const [
		{ data: metadataDetails, isLoading: isMetadataDetailsLoading },
		isMetadataPartialStatusActive,
	] = useMetadataDetails(props.metadataId, inViewport);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
		inViewport,
	);
	const { data: isMetadataRecentlyConsumed } = useUserEntityRecentlyConsumed(
		props.metadataId,
		EntityLot.Metadata,
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
		[UserToMediaReason.Finished, UserToMediaReason.Owned].includes(r),
	);

	const extraInformation = useMemo(() => {
		if (!metadataDetails || !userMetadataDetails) return "";

		const inProgress = userMetadataDetails.inProgress;
		if (inProgress) {
			if (inProgress.podcastExtraInformation)
				return `Current: EP-${inProgress.podcastExtraInformation.episode}`;
			if (inProgress.showExtraInformation)
				return `Current: S${inProgress.showExtraInformation.season}-E${inProgress.showExtraInformation.episode}`;
		}

		const nextEntry = userMetadataDetails.nextEntry;
		if (nextEntry) {
			if (metadataDetails.lot === MediaLot.Show)
				return `Next: S${nextEntry.season}-E${nextEntry.episode}`;
			if (metadataDetails.lot === MediaLot.Podcast)
				return `Next: EP-${nextEntry.episode}`;
		}

		return "";
	}, [metadataDetails, userMetadataDetails]);

	const s3PresignedUrls = useS3PresignedUrls(metadataDetails?.assets.s3Images);
	const images = [
		...(metadataDetails?.assets.remoteImages || []),
		...(s3PresignedUrls.data || []),
	];

	return (
		<BaseEntityDisplayItem
			ref={ref}
			image={images.at(0)}
			progress={currentProgress}
			entityId={props.metadataId}
			userToMediaReasons={reasons}
			title={metadataDetails?.title}
			entityLot={EntityLot.Metadata}
			isFirstItem={props.isFirstItem}
			mediaLot={metadataDetails?.lot}
			rating={averageRating ?? undefined}
			centerElement={props.centerElement}
			imageClassName={props.imageClassName}
			isDetailsLoading={isMetadataDetailsLoading}
			wasRecentlyConsumed={isMetadataRecentlyConsumed}
			isPartialStatusActive={isMetadataPartialStatusActive}
			interactionButtons={["collection", "consume", "review", "watchlist"]}
			hasInteracted={
				props.shouldHighlightNameIfInteracted &&
				userMetadataDetails?.hasInteracted
			}
			onImageClickBehavior={[
				$path("/media/item/:id", { id: props.metadataId }),
				props.onImageClickBehavior,
			]}
			consumeButtonIndicatorLabel={
				completedHistory.length > 0 ? `${completedHistory.length}` : undefined
			}
			additionalInformation={[
				extraInformation,
				props.additionalInformation,
				metadataDetails?.publishYear,
			]}
		/>
	);
};

export const MetadataGroupDisplayItem = (props: {
	noEntityLot?: boolean;
	metadataGroupId: string;
	centerElement?: ReactNode;
	shouldHighlightNameIfInteracted?: boolean;
}) => {
	const { ref, inViewport } = useInViewport();
	const [
		{ data: metadataGroupDetails, isLoading: isMetadataGroupDetailsLoading },
		isMetadataGroupPartialStatusActive,
		metadataGroupTranslations,
	] = useMetadataGroupDetails(props.metadataGroupId, inViewport);
	const { data: userMetadataGroupDetails } = useUserMetadataGroupDetails(
		props.metadataGroupId,
		inViewport,
	);
	const { data: isMetadataGroupRecentlyConsumed } =
		useUserEntityRecentlyConsumed(
			props.metadataGroupId,
			EntityLot.MetadataGroup,
			inViewport,
		);

	const averageRating = userMetadataGroupDetails?.averageRating;

	const defaultAdditionalInformation = useMemo(() => {
		const final = [];
		if (!props.noEntityLot)
			final.push(changeCase(snakeCase(EntityLot.MetadataGroup)));

		if (metadataGroupDetails)
			final.push(`${metadataGroupDetails.details.parts} items`);

		return final;
	}, [metadataGroupDetails, props.noEntityLot]);

	const s3PresignedUrls = useS3PresignedUrls(
		metadataGroupDetails?.details.assets.s3Images,
	);
	const images = [
		...(metadataGroupDetails?.details.assets.remoteImages || []),
		...(s3PresignedUrls.data || []),
	];

	return (
		<BaseEntityDisplayItem
			ref={ref}
			image={images.at(0)}
			entityId={props.metadataGroupId}
			rating={averageRating ?? undefined}
			entityLot={EntityLot.MetadataGroup}
			centerElement={props.centerElement}
			mediaLot={metadataGroupDetails?.details.lot}
			isDetailsLoading={isMetadataGroupDetailsLoading}
			additionalInformation={defaultAdditionalInformation}
			wasRecentlyConsumed={isMetadataGroupRecentlyConsumed}
			interactionButtons={["collection", "review", "watchlist"]}
			isPartialStatusActive={isMetadataGroupPartialStatusActive}
			title={
				metadataGroupTranslations?.title || metadataGroupDetails?.details.title
			}
			onImageClickBehavior={[
				$path("/media/groups/item/:id", { id: props.metadataGroupId }),
			]}
			hasInteracted={
				props.shouldHighlightNameIfInteracted &&
				userMetadataGroupDetails?.hasInteracted
			}
		/>
	);
};

export const PersonDisplayItem = (props: {
	personId: string;
	centerElement?: ReactNode;
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
	const { data: isPersonRecentlyConsumed } = useUserEntityRecentlyConsumed(
		props.personId,
		EntityLot.Person,
		inViewport,
	);

	const averageRating = userPersonDetails?.averageRating;

	const defaultAdditionalInformation = useMemo(() => {
		const final = [];

		if (personDetails)
			final.push(`${personDetails.details.associatedEntityCount} items`);

		return final;
	}, [personDetails]);

	const s3PresignedUrls = useS3PresignedUrls(
		personDetails?.details.assets.s3Images,
	);
	const images = [
		...(personDetails?.details.assets.remoteImages || []),
		...(s3PresignedUrls.data || []),
	];

	return (
		<BaseEntityDisplayItem
			ref={ref}
			image={images.at(0)}
			entityId={props.personId}
			entityLot={EntityLot.Person}
			rating={averageRating ?? undefined}
			title={personDetails?.details.name}
			centerElement={props.centerElement}
			isDetailsLoading={isPersonDetailsLoading}
			interactionButtons={["collection", "review"]}
			wasRecentlyConsumed={isPersonRecentlyConsumed}
			isPartialStatusActive={isPersonPartialStatusActive}
			additionalInformation={defaultAdditionalInformation}
			onImageClickBehavior={[
				$path("/media/people/item/:id", { id: props.personId }),
			]}
			hasInteracted={
				props.shouldHighlightNameIfInteracted &&
				userPersonDetails?.hasInteracted
			}
		/>
	);
};
