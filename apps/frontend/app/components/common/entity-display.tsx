import {
	ActionIcon,
	type ActionIconProps,
	Badge,
	Box,
	Card,
	Flex,
	Group,
	Image,
	type MantineStyleProp,
	Overlay,
	Paper,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	type EntityLot,
	type MediaLot,
	UserReviewScale,
	UserToMediaReason,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials } from "@ryot/ts-utils";
import {
	IconArchive,
	IconBackpack,
	IconBookmark,
	IconBookmarkOff,
	IconBookmarks,
	IconEye,
	IconMessage,
	IconRosetteDiscountCheck,
} from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";
import { forwardRef } from "react";
import { Link } from "react-router";
import { match } from "ts-pattern";
import {
	useAddEntitiesToCollectionMutation,
	useCoreDetails,
	useCurrentColorSchema,
	useEntityAlreadyInCollections,
	useFallbackImageUrl,
	useRemoveEntitiesFromCollectionMutation,
	useUserDetails,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { getMetadataIcon } from "~/lib/shared/media-utils";
import {
	useAddEntityToCollections,
	useMetadataProgressUpdate,
	useReviewEntity,
} from "~/lib/state/media";
import { useOnboardingTour } from "~/lib/state/onboarding-tour";
import classes from "~/styles/common.module.css";

const getThemeColor = (colorName: string, mode: string): string => {
	const shade = mode === "dark" ? "3" : "7";
	return `var(--mantine-color-${colorName}-${shade})`;
};

const overlayIconBoxStyle = {
	borderRadius: 4,
	backgroundColor: "rgba(0, 0, 0, 0.9)",
	boxShadow: "0 2px 4px rgba(0, 0, 0, 0.3)",
	border: "1px solid rgba(255, 255, 255, 0.4)",
} satisfies MantineStyleProp;

const mediaIconBoxStyle = {
	borderRadius: 4,
	backgroundColor: "rgba(0, 0, 0, 0.95)",
	boxShadow: "0 2px 4px rgba(0, 0, 0, 0.3)",
	border: "1px solid rgba(255, 255, 255, 0.3)",
} satisfies MantineStyleProp;

const ratingBadgeStyle = {
	color: "white",
	backgroundColor: "rgba(0, 0, 0, 0.95)",
	boxShadow: "0 2px 4px rgba(0, 0, 0, 0.3)",
	border: "1px solid rgba(255, 255, 255, 0.2)",
} satisfies MantineStyleProp;

const EntityActionButton = (props: {
	label: string;
	colorName: string;
	className?: string;
	onClick: () => void;
	entityButtonProps: ActionIconProps;
	icon: ComponentType<{ size: number; color: string }>;
}) => {
	const mode = useCurrentColorSchema();
	return (
		<Tooltip label={props.label}>
			<ActionIcon
				onClick={props.onClick}
				className={props.className}
				{...props.entityButtonProps}
			>
				<props.icon size={20} color={getThemeColor(props.colorName, mode)} />
			</ActionIcon>
		</Tooltip>
	);
};

const formatBaseEntityDisplayItemRating = (
	rating: number,
	scale: UserReviewScale,
): string => {
	switch (scale) {
		case UserReviewScale.OutOfHundred:
			return `${rating}%`;
		case UserReviewScale.OutOfTen:
			return `${(rating / 10).toFixed(1)}/10`;
		case UserReviewScale.OutOfFive:
			return `${(rating / 20).toFixed(1)}/5`;
		case UserReviewScale.ThreePointSmiley:
			if (rating >= 67) return "😊";
			if (rating >= 34) return "😐";
			return "😞";
	}
};

const BaseEntityDisplayItemReason = (props: {
	reason: UserToMediaReason;
}) => {
	const [Icon, color] = match(props.reason)
		.with(
			UserToMediaReason.Owned,
			() => [IconBackpack, "var(--mantine-color-blue-4)"] as const,
		)
		.with(
			UserToMediaReason.Watchlist,
			() => [IconBookmarks, "var(--mantine-color-yellow-4)"] as const,
		)
		.with(
			UserToMediaReason.Finished,
			() => [IconRosetteDiscountCheck, "var(--mantine-color-green-4)"] as const,
		)
		.otherwise(() => [null, null] as const);

	if (!Icon || !color) return null;

	return (
		<Tooltip label={changeCase(props.reason)}>
			<Flex
				w={24}
				h={24}
				align="center"
				justify="center"
				style={overlayIconBoxStyle}
			>
				<Icon size={16} color={color} />
			</Flex>
		</Tooltip>
	);
};

type BaseEntityDisplayItemCard = {
	title?: string;
	image?: string;
	rating?: string;
	entityId: string;
	progress?: string;
	mediaLot?: MediaLot;
	entityLot: EntityLot;
	imageClassName?: string;
	hasInteracted?: boolean;
	centerElement?: ReactNode;
	isDetailsLoading: boolean;
	wasRecentlyConsumed?: boolean;
	consumeButtonClassName?: string;
	isPartialStatusActive?: boolean;
	userToMediaReasons?: UserToMediaReason[];
	onImageClickBehavior: [string, (() => Promise<void>)?];
	additionalInformation?: (string | number | null | undefined)[];
	interactionButtons: ("consume" | "watchlist" | "collection" | "review")[];
};

export const BaseEntityDisplayItem = forwardRef<
	HTMLDivElement,
	BaseEntityDisplayItemCard
>((props, ref) => {
	const mode = useCurrentColorSchema();
	const coreDetails = useCoreDetails();
	const userDetails = useUserDetails();
	const userPreferences = useUserPreferences();
	const [_r, setEntityToReview] = useReviewEntity();
	const ratingScale = userPreferences.general.reviewScale;
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const MediaIcon = props.mediaLot ? getMetadataIcon(props.mediaLot) : null;
	const { initializeMetadataToUpdate } = useMetadataProgressUpdate();
	const addEntitiesToCollection = useAddEntitiesToCollectionMutation();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();
	const progress = props.progress ? Number(props.progress) : undefined;
	const removeEntitiesFromCollection =
		useRemoveEntitiesFromCollectionMutation();
	const shouldHighlightImage =
		coreDetails.isServerKeyValidated && props.wasRecentlyConsumed;
	const topRowCount =
		(props.userToMediaReasons || []).length + (props.rating ? 1 : 0);
	const { alreadyInCollectionNames } = useEntityAlreadyInCollections(
		props.entityId,
		props.entityLot,
	);
	const alreadyInWatchlist = alreadyInCollectionNames.includes("Watchlist");
	const fallback = useFallbackImageUrl(
		props.isDetailsLoading
			? "Loading..."
			: props.title
				? getInitials(props.title)
				: undefined,
	);

	const entityButtonProps: ActionIconProps = {
		size: 28,
		variant: "default",
	};

	const entityInformation = (props.additionalInformation || [])
		.filter(Boolean)
		.join(" • ");

	return (
		<Card
			p={0}
			w={140}
			h={240}
			ref={ref}
			pos="relative"
			className={props.imageClassName}
			withBorder={!shouldHighlightImage}
			style={{
				overflow: "hidden",
				boxShadow: shouldHighlightImage
					? mode === "dark"
						? "0px 0px 4px 1px rgba(242, 183, 22, 1)"
						: "0px 0px 8px 3px rgba(24, 142, 245, 1)"
					: undefined,
			}}
		>
			{props.centerElement ? (
				<>
					<Overlay />
					<Paper
						top="50%"
						left="50%"
						withBorder
						pos="absolute"
						style={{ zIndex: 1000, transform: "translate(-50%, -50%)" }}
					>
						{props.centerElement}
					</Paper>
				</>
			) : null}
			<Link
				to={props.onImageClickBehavior[0]}
				onClick={props.onImageClickBehavior[1]}
				style={{ width: "100%", height: "100%" }}
			>
				<Image
					w="100%"
					h="100%"
					fit="cover"
					src={props.image}
					fallbackSrc={fallback}
				/>
			</Link>

			<Group pos="absolute" wrap="nowrap" w="100%" gap={2} p={2}>
				{props.userToMediaReasons?.map((reason) => (
					<BaseEntityDisplayItemReason key={reason} reason={reason} />
				))}
				{MediaIcon && topRowCount <= 3 ? (
					<Flex
						w={24}
						h={24}
						align="center"
						justify="center"
						style={mediaIconBoxStyle}
					>
						<MediaIcon size={16} color="white" />
					</Flex>
				) : null}
				{props.rating && (
					<Badge
						ml="auto"
						size="sm"
						style={{
							...ratingBadgeStyle,
							fontSize:
								ratingScale === UserReviewScale.ThreePointSmiley
									? "12px"
									: "10px",
						}}
					>
						{formatBaseEntityDisplayItemRating(
							Number(props.rating),
							ratingScale,
						)}
					</Badge>
				)}
			</Group>
			<Box
				pt={32}
				left={0}
				right={0}
				bottom={0}
				pos="absolute"
				pb={progress ? 8 : 4}
				style={{
					background:
						mode === "dark"
							? "linear-gradient(to top, black, rgba(31, 41, 55, 0.95), transparent)"
							: "linear-gradient(to top, black, rgba(0, 0, 0, 0.85), transparent)",
				}}
			>
				<Stack gap={8}>
					<Box ta="center" px="xs">
						<Text
							size="xs"
							c="gray.1"
							style={{ textShadow: "1px 1px 1px rgba(0, 0, 0, 0.8)" }}
						>
							{entityInformation}
						</Text>
						<Tooltip label={props.title}>
							<Text
								fw={700}
								size="sm"
								lineClamp={1}
								c={props.hasInteracted ? "yellow.4" : "white"}
								style={{ textShadow: "1px 1px 2px rgba(0, 0, 0, 0.5)" }}
								className={
									props.isPartialStatusActive ? classes.fadeInOut : undefined
								}
							>
								{props.title}
							</Text>
						</Tooltip>
					</Box>
					<Group gap={6} justify="center" wrap="nowrap">
						{props.interactionButtons.includes("consume") && (
							<EntityActionButton
								icon={IconEye}
								colorName="green"
								label="Add to history"
								entityButtonProps={entityButtonProps}
								className={props.consumeButtonClassName}
								onClick={() => {
									if (props.consumeButtonClassName) advanceOnboardingTourStep();
									initializeMetadataToUpdate(
										{ metadataId: props.entityId },
										true,
									);
								}}
							/>
						)}
						{props.interactionButtons.includes("watchlist") && (
							<EntityActionButton
								colorName="blue"
								entityButtonProps={entityButtonProps}
								icon={alreadyInWatchlist ? IconBookmarkOff : IconBookmark}
								label={`${alreadyInWatchlist ? "Remove from" : "Add to"} watchlist`}
								onClick={async () => {
									const mutation = alreadyInWatchlist
										? removeEntitiesFromCollection
										: addEntitiesToCollection;
									await mutation.mutateAsync({
										collectionName: "Watchlist",
										creatorUserId: userDetails.id,
										entities: [
											{
												entityId: props.entityId,
												entityLot: props.entityLot,
											},
										],
									});
									notifications.show({
										color: "green",
										message: `${alreadyInWatchlist ? "Removed from" : "Added to"} your watchlist`,
									});
								}}
							/>
						)}
						{props.interactionButtons.includes("collection") && (
							<EntityActionButton
								icon={IconArchive}
								colorName="violet"
								label="Add to collections"
								entityButtonProps={entityButtonProps}
								onClick={() => {
									setAddEntityToCollectionsData({
										entityId: props.entityId,
										entityLot: props.entityLot,
									});
								}}
							/>
						)}
						{props.interactionButtons.includes("review") && (
							<EntityActionButton
								icon={IconMessage}
								colorName="orange"
								label="Leave a review"
								entityButtonProps={entityButtonProps}
								onClick={() => {
									setEntityToReview({
										metadataLot: props.mediaLot,
										entityId: props.entityId,
										entityLot: props.entityLot,
										entityTitle: props.title ?? "Unknown Title",
									});
								}}
							/>
						)}
					</Group>
				</Stack>
			</Box>
			{progress ? (
				<Box
					h={4}
					left={0}
					right={0}
					bottom={0}
					pos="absolute"
					w={`${progress}%`}
					style={{
						transition: "width 500ms ease",
						backgroundColor: "var(--mantine-color-red-4)",
						filter: "drop-shadow(0 0 1px rgba(239, 68, 68, 0.8))",
					}}
				/>
			) : null}
		</Card>
	);
});
