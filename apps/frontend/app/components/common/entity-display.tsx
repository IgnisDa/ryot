import {
	ActionIcon,
	type ActionIconProps,
	Badge,
	Box,
	Card,
	Flex,
	Group,
	Image,
	Indicator,
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
	IconEye,
	IconMessage,
	IconRosetteDiscountCheck,
} from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";
import { forwardRef, memo, useCallback, useMemo } from "react";
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
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
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

const fullSizeStyle = {
	width: "100%",
	height: "100%",
} as const;

const centerElementPaperStyle = {
	zIndex: 1000,
	transform: "translate(-50%, -50%)",
} as const;

const entityInfoTextShadowStyle = {
	textShadow: "1px 1px 1px rgba(0, 0, 0, 0.8)",
} as const;

const titleTextShadowStyle = {
	transition: "color 200ms ease",
	textShadow: "1px 1px 2px rgba(0, 0, 0, 0.5)",
} as const;

const progressBarBaseStyle = {
	transition: "width 500ms ease",
	backgroundColor: "var(--mantine-color-red-4)",
	filter: "drop-shadow(0 0 1px rgba(239, 68, 68, 0.8))",
} as const;

const formatBaseEntityDisplayItemRating = (
	rating: number,
	scale: UserReviewScale,
): string => {
	switch (scale) {
		case UserReviewScale.OutOfHundred:
			return `${rating.toFixed(1)}%`;
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

const EntityActionButton = (props: {
	mode: string;
	label: string;
	colorName: string;
	className?: string;
	entityButtonProps: ActionIconProps;
	onClick: () => void | Promise<void>;
	consumeButtonIndicatorLabel?: string;
	icon: ComponentType<{ size: number; color: string }>;
}) => (
	<Tooltip label={props.label}>
		<Indicator
			offset={4}
			zIndex={10}
			color="violet"
			position="bottom-center"
			disabled={!props.consumeButtonIndicatorLabel}
			label={<Text fz={10}>{props.consumeButtonIndicatorLabel}</Text>}
		>
			<ActionIcon
				onClick={props.onClick}
				className={props.className}
				{...props.entityButtonProps}
			>
				<props.icon
					size={20}
					color={getThemeColor(props.colorName, props.mode)}
				/>
			</ActionIcon>
		</Indicator>
	</Tooltip>
);

type ActionButtonsProps = {
	mode: string;
	onReview: () => void;
	onConsume: () => void;
	isFirstItem?: boolean;
	alreadyInWatchlist: boolean;
	onOpenCollections: () => void;
	consumeButtonIndicatorLabel?: string;
	onToggleWatchlist: () => Promise<void>;
	interactionButtons: BaseEntityDisplayItemCard["interactionButtons"];
};

const ActionButtons = memo((props: ActionButtonsProps) => {
	const entityButtonProps = useMemo<ActionIconProps>(
		() => ({ size: 28, variant: "default" }),
		[],
	);

	return (
		<>
			{props.interactionButtons.includes("consume") && (
				<EntityActionButton
					icon={IconEye}
					mode={props.mode}
					colorName="green"
					label="Add to history"
					onClick={props.onConsume}
					entityButtonProps={entityButtonProps}
					consumeButtonIndicatorLabel={props.consumeButtonIndicatorLabel}
					className={
						props.isFirstItem
							? OnboardingTourStepTargets.OpenMetadataProgressForm
							: undefined
					}
				/>
			)}
			{props.interactionButtons.includes("watchlist") && (
				<EntityActionButton
					colorName="blue"
					mode={props.mode}
					onClick={props.onToggleWatchlist}
					entityButtonProps={entityButtonProps}
					icon={props.alreadyInWatchlist ? IconBookmarkOff : IconBookmark}
					label={`${props.alreadyInWatchlist ? "Remove from" : "Add to"} watchlist`}
				/>
			)}
			{props.interactionButtons.includes("collection") && (
				<EntityActionButton
					mode={props.mode}
					icon={IconArchive}
					colorName="violet"
					label="Add to collections"
					onClick={props.onOpenCollections}
					entityButtonProps={entityButtonProps}
				/>
			)}
			{props.interactionButtons.includes("review") && (
				<EntityActionButton
					mode={props.mode}
					icon={IconMessage}
					colorName="orange"
					label="Leave a review"
					onClick={props.onReview}
					entityButtonProps={entityButtonProps}
				/>
			)}
		</>
	);
});

type BaseEntityDisplayItemCard = {
	title?: string;
	image?: string;
	rating?: string;
	entityId: string;
	progress?: string;
	mediaLot?: MediaLot;
	entityLot: EntityLot;
	isFirstItem?: boolean;
	imageClassName?: string;
	hasInteracted?: boolean;
	centerElement?: ReactNode;
	isDetailsLoading: boolean;
	wasRecentlyConsumed?: boolean;
	isPartialStatusActive?: boolean;
	consumeButtonIndicatorLabel?: string;
	userToMediaReasons?: UserToMediaReason[];
	onImageClickBehavior: [string, (() => Promise<void>)?];
	additionalInformation?: (string | number | null | undefined)[];
	interactionButtons: ("consume" | "watchlist" | "collection" | "review")[];
};

const BaseEntityDisplayItemComponent = forwardRef<
	HTMLDivElement,
	BaseEntityDisplayItemCard
>((props, viewportRef) => {
	const mode = useCurrentColorSchema();
	const coreDetails = useCoreDetails();
	const userDetails = useUserDetails();
	const userPreferences = useUserPreferences();
	const [_r, setEntityToReview] = useReviewEntity();
	const ratingScale = userPreferences.general.reviewScale;
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const { initializeMetadataToUpdate } = useMetadataProgressUpdate();
	const addEntitiesToCollection = useAddEntitiesToCollectionMutation();
	const [_a, setAddEntityToCollectionsData] = useAddEntityToCollections();
	const MediaIcon = props.mediaLot ? getMetadataIcon(props.mediaLot) : null;
	const removeEntitiesFromCollection =
		useRemoveEntitiesFromCollectionMutation();
	const { alreadyInCollectionNames } = useEntityAlreadyInCollections(
		props.entityId,
		props.entityLot,
	);
	const alreadyInWatchlist = alreadyInCollectionNames.includes("Watchlist");
	const shouldHighlightImage =
		coreDetails.isServerKeyValidated && props.wasRecentlyConsumed;

	const progress = useMemo(() => {
		if (props.progress === undefined || props.progress === null)
			return undefined;
		const value = Number(props.progress);
		return Number.isNaN(value) ? undefined : value;
	}, [props.progress]);
	const fallback = useFallbackImageUrl(
		props.isDetailsLoading
			? "Loading..."
			: props.title
				? getInitials(props.title)
				: undefined,
	);

	const entityInformation = useMemo(() => {
		if (!props.additionalInformation) return "";
		return props.additionalInformation.filter(Boolean).join(" • ");
	}, [props.additionalInformation]);
	const cardStyle = useMemo<MantineStyleProp>(
		() => ({
			overflow: "hidden",
			transition: "box-shadow 200ms ease",
			boxShadow: shouldHighlightImage
				? mode === "dark"
					? "0px 0px 4px 1px rgba(242, 183, 22, 1)"
					: "0px 0px 8px 3px rgba(24, 142, 245, 1)"
				: undefined,
		}),
		[mode, shouldHighlightImage],
	);
	const gradientBackgroundStyle = useMemo<MantineStyleProp>(
		() => ({
			background:
				mode === "dark"
					? "linear-gradient(to top, black, rgba(31, 41, 55, 0.95), transparent)"
					: "linear-gradient(to top, black, rgba(0, 0, 0, 0.85), transparent)",
		}),
		[mode],
	);
	const ratingBadgeStyleValue = useMemo(
		() => ({
			...ratingBadgeStyle,
			fontSize:
				ratingScale === UserReviewScale.ThreePointSmiley ? "12px" : "10px",
		}),
		[ratingScale],
	);
	const handleConsume = useCallback(() => {
		advanceOnboardingTourStep();
		initializeMetadataToUpdate({ metadataId: props.entityId }, true);
	}, [props.entityId, advanceOnboardingTourStep, initializeMetadataToUpdate]);
	const handleToggleWatchlist = useCallback(async () => {
		const mutation = alreadyInWatchlist
			? removeEntitiesFromCollection
			: addEntitiesToCollection;
		await mutation.mutateAsync({
			collectionName: "Watchlist",
			creatorUserId: userDetails.id,
			entities: [{ entityId: props.entityId, entityLot: props.entityLot }],
		});
		notifications.show({
			color: "green",
			message: `${alreadyInWatchlist ? "Removed from" : "Added to"} your watchlist`,
		});
	}, [
		userDetails.id,
		props.entityId,
		props.entityLot,
		alreadyInWatchlist,
		addEntitiesToCollection,
		removeEntitiesFromCollection,
	]);
	const handleOpenCollections = useCallback(() => {
		setAddEntityToCollectionsData({
			entityId: props.entityId,
			entityLot: props.entityLot,
		});
	}, [props.entityId, props.entityLot, setAddEntityToCollectionsData]);
	const handleReview = useCallback(() => {
		setEntityToReview({
			entityId: props.entityId,
			entityLot: props.entityLot,
			metadataLot: props.mediaLot,
			entityTitle: props.title ?? "Unknown Title",
		});
	}, [
		props.title,
		props.mediaLot,
		props.entityId,
		props.entityLot,
		setEntityToReview,
	]);
	const actionButtonsProps = useMemo(
		() => ({
			mode,
			alreadyInWatchlist,
			onReview: handleReview,
			onConsume: handleConsume,
			isFirstItem: props.isFirstItem,
			onToggleWatchlist: handleToggleWatchlist,
			onOpenCollections: handleOpenCollections,
			interactionButtons: props.interactionButtons,
			consumeButtonIndicatorLabel: props.consumeButtonIndicatorLabel,
		}),
		[
			mode,
			handleReview,
			handleConsume,
			props.isFirstItem,
			alreadyInWatchlist,
			handleOpenCollections,
			handleToggleWatchlist,
			props.interactionButtons,
			props.consumeButtonIndicatorLabel,
		],
	);

	return (
		<Card
			p={0}
			h={240}
			w="100%"
			pos="relative"
			style={cardStyle}
			ref={viewportRef}
			className={props.imageClassName}
			withBorder={!shouldHighlightImage}
		>
			{props.centerElement ? (
				<>
					<Overlay />
					<Paper
						top="50%"
						left="50%"
						withBorder
						pos="absolute"
						style={centerElementPaperStyle}
					>
						{props.centerElement}
					</Paper>
				</>
			) : null}
			<Link
				style={fullSizeStyle}
				to={props.onImageClickBehavior[0]}
				onClick={props.onImageClickBehavior[1]}
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
				{MediaIcon && props.mediaLot ? (
					<Tooltip label={changeCase(props.mediaLot)}>
						<Flex
							w={24}
							h={24}
							align="center"
							justify="center"
							style={mediaIconBoxStyle}
						>
							<MediaIcon size={16} color="white" />
						</Flex>
					</Tooltip>
				) : null}
				{props.rating && (
					<Badge ml="auto" size="sm" style={ratingBadgeStyleValue}>
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
				style={gradientBackgroundStyle}
			>
				<Stack gap={8}>
					<Box ta="center" px="xs">
						<Text size="xs" c="gray.1" style={entityInfoTextShadowStyle}>
							{entityInformation}
						</Text>
						<Tooltip label={props.title}>
							<Text
								fw={700}
								size="sm"
								lineClamp={1}
								style={titleTextShadowStyle}
								c={props.hasInteracted ? "yellow.4" : "white"}
								className={
									props.isPartialStatusActive ? classes.fadeInOut : undefined
								}
							>
								{props.title}
							</Text>
						</Tooltip>
					</Box>
					<Group gap="xs" justify="center" wrap="nowrap">
						<ActionButtons {...actionButtonsProps} />
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
					style={progressBarBaseStyle}
				/>
			) : null}
		</Card>
	);
});

export const BaseEntityDisplayItem = memo(BaseEntityDisplayItemComponent);
