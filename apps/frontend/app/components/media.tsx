import {
	ActionIcon,
	Anchor,
	Avatar,
	Box,
	Group,
	Loader,
	Menu,
	ScrollArea,
	Text,
	ThemeIcon,
	Tooltip,
} from "@mantine/core";
import { useInViewport } from "@mantine/hooks";
import {
	EntityLot,
	MediaLot,
	SeenState,
	UserReviewScale,
	UserToMediaReason,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase } from "@ryot/ts-utils";
import {
	IconBackpack,
	IconBookmarks,
	IconPlayerPlay,
	IconRosetteDiscountCheck,
	IconStarFilled,
} from "@tabler/icons-react";
import { type ReactNode, useMemo } from "react";
import { Form, Link } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import {
	BaseMediaDisplayItem,
	DisplayThreePointReview,
	MEDIA_DETAILS_HEIGHT,
} from "~/components/common";
import { openConfirmationModal, reviewYellow } from "~/lib/common";
import {
	useAddEntitiesToCollection,
	useConfirmSubmit,
	useMetadataDetails,
	useMetadataGroupDetails,
	usePersonDetails,
	useRemoveEntitiesFromCollection,
	useUserDetails,
	useUserMetadataDetails,
	useUserMetadataGroupDetails,
	useUserPersonDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { useOnboardingTour } from "~/lib/state/general";
import { useMetadataProgressUpdate, useReviewEntity } from "~/lib/state/media";
import classes from "~/styles/common.module.css";

const WrapperComponent = (props: { link?: string; children: ReactNode }) =>
	props.link ? (
		<Anchor component={Link} to={props.link}>
			{props.children}
		</Anchor>
	) : (
		<Box>{props.children}</Box>
	);

export const BaseEntityDisplay = (props: {
	link?: string;
	image?: string;
	title?: string;
	extraText?: string;
	hasInteracted?: boolean;
}) => {
	return (
		<WrapperComponent link={props.link}>
			<Avatar
				w={85}
				h={100}
				mx="auto"
				radius="sm"
				src={props.image}
				name={props.title}
				imageProps={{ loading: "lazy" }}
				styles={{ image: { objectPosition: "top" } }}
			/>
			<Text
				mt={4}
				size="xs"
				ta="center"
				lineClamp={1}
				c={props.hasInteracted ? "yellow" : "dimmed"}
			>
				{props.title} {props.extraText}
			</Text>
		</WrapperComponent>
	);
};

export const PartialMetadataDisplay = (props: {
	metadataId: string;
	extraText?: string;
}) => {
	const { data: metadataDetails } = useMetadataDetails(props.metadataId);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
	);

	const images = [
		...(metadataDetails?.assets.remoteImages || []),
		...(metadataDetails?.assets.s3Images || []),
	];

	return (
		<BaseEntityDisplay
			image={images.at(0)}
			extraText={props.extraText}
			title={metadataDetails?.title || undefined}
			hasInteracted={userMetadataDetails?.hasInteracted}
			link={$path("/media/item/:id", { id: props.metadataId })}
		/>
	);
};

export const MediaScrollArea = (props: { children: ReactNode }) => {
	return (
		<ScrollArea.Autosize mah={MEDIA_DETAILS_HEIGHT}>
			{props.children}
		</ScrollArea.Autosize>
	);
};

const DisplayAverageRatingOverlay = (props: {
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
							? " %"
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

export const MetadataDisplayItem = (props: {
	name?: string;
	altName?: string;
	metadataId: string;
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
	const [_m, setMetadataToUpdate, isMetadataToUpdateLoading] =
		useMetadataProgressUpdate();
	const { ref, inViewport } = useInViewport();
	const { isOnboardingTourInProgress, advanceOnboardingTourStep } =
		useOnboardingTour();

	const { data: metadataDetails, isLoading: isMetadataDetailsLoading } =
		useMetadataDetails(props.metadataId, inViewport);
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
	}, [metadataDetails, userMetadataDetails]);

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
		<BaseMediaDisplayItem
			innerRef={ref}
			imageUrl={images.at(0)}
			altName={props.altName}
			progress={currentProgress}
			isLoading={isMetadataDetailsLoading}
			imageClassName={props.imageClassName}
			name={props.name ?? metadataDetails?.title}
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
				bottomRight: isMetadataToUpdateLoading ? (
					<Loader color="red" size="xs" m={2} />
				) : (
					<ActionIcon
						color="blue"
						size="compact-md"
						variant="transparent"
						className={props.bottomRightImageOverlayClassName}
						onClick={async () => {
							setMetadataToUpdate({ metadataId: props.metadataId }, true);

							if (
								isOnboardingTourInProgress &&
								props.bottomRightImageOverlayClassName
							) {
								await new Promise((resolve) => setTimeout(resolve, 7000));
								advanceOnboardingTourStep();
							}
						}}
					>
						<IconPlayerPlay size={20} />
					</ActionIcon>
				),
			}}
		/>
	);
};

export const MetadataGroupDisplayItem = (props: {
	topRight?: ReactNode;
	noLeftLabel?: boolean;
	rightLabel?: ReactNode;
	metadataGroupId: string;
	shouldHighlightNameIfInteracted?: boolean;
}) => {
	const { ref, inViewport } = useInViewport();
	const { data: metadataDetails, isLoading: isMetadataDetailsLoading } =
		useMetadataGroupDetails(props.metadataGroupId, inViewport);
	const { data: userMetadataGroupDetails } = useUserMetadataGroupDetails(
		props.metadataGroupId,
		inViewport,
	);

	const averageRating = userMetadataGroupDetails?.averageRating;

	return (
		<BaseMediaDisplayItem
			innerRef={ref}
			isLoading={isMetadataDetailsLoading}
			name={metadataDetails?.details.title}
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
	topRight?: ReactNode;
	rightLabel?: ReactNode;
	shouldHighlightNameIfInteracted?: boolean;
}) => {
	const { ref, inViewport } = useInViewport();
	const { data: personDetails, isLoading: isPersonDetailsLoading } =
		usePersonDetails(props.personId, inViewport);
	const { data: userPersonDetails } = useUserPersonDetails(
		props.personId,
		inViewport,
	);

	const averageRating = userPersonDetails?.averageRating;

	return (
		<BaseMediaDisplayItem
			innerRef={ref}
			name={personDetails?.details.name}
			isLoading={isPersonDetailsLoading}
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

export const ToggleMediaMonitorMenuItem = (props: {
	formValue: string;
	entityLot: EntityLot;
	inCollections: Array<string>;
}) => {
	const isMonitored = props.inCollections.includes("Monitoring");
	const userDetails = useUserDetails();
	const addEntitiesToCollection = useAddEntitiesToCollection();
	const removeEntitiesFromCollection = useRemoveEntitiesFromCollection();

	const handleToggleMonitoring = () => {
		const entityData = {
			entityId: props.formValue,
			entityLot: props.entityLot,
		};

		if (isMonitored) {
			openConfirmationModal("Are you sure you want to stop monitoring?", () => {
				removeEntitiesFromCollection.mutate({
					collectionName: "Monitoring",
					creatorUserId: userDetails.id,
					entities: [entityData],
				});
			});
		} else {
			addEntitiesToCollection.mutate({
				collectionName: "Monitoring",
				creatorUserId: userDetails.id,
				entities: [entityData],
			});
		}
	};

	return (
		<Menu.Item
			onClick={handleToggleMonitoring}
			disabled={
				addEntitiesToCollection.isPending ||
				removeEntitiesFromCollection.isPending
			}
		>
			{isMonitored ? "Stop" : "Start"} monitoring
		</Menu.Item>
	);
};

export const MarkEntityAsPartialMenuItem = (props: {
	entityId: string;
	entityLot: EntityLot;
}) => {
	const submit = useConfirmSubmit();

	return (
		<Form
			replace
			method="POST"
			onSubmit={(e) => submit(e)}
			action={withQuery($path("/actions"), {
				intent: "markEntityAsPartial",
			})}
		>
			<input hidden name="entityId" defaultValue={props.entityId} />
			<input hidden name="entityLot" defaultValue={props.entityLot} />
			<Menu.Item type="submit">Update details</Menu.Item>
		</Form>
	);
};
