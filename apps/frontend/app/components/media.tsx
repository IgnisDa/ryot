import {
	ActionIcon,
	Anchor,
	Avatar,
	Group,
	Loader,
	Menu,
	ScrollArea,
	Text,
	ThemeIcon,
	Tooltip,
} from "@mantine/core";
import { $path } from "remix-routes";
import "@mantine/dates/styles.css";
import { useInViewport } from "@mantine/hooks";
import { Form, Link } from "@remix-run/react";
import {
	EntityLot,
	MetadataGroupDetailsDocument,
	PersonDetailsDocument,
	SeenState,
	UserMetadataGroupDetailsDocument,
	UserPersonDetailsDocument,
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
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import {
	BaseMediaDisplayItem,
	DisplayThreePointReview,
	MEDIA_DETAILS_HEIGHT,
} from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import {
	clientGqlService,
	getPartialMetadataDetailsQuery,
	queryFactory,
	reviewYellow,
} from "~/lib/generals";
import {
	useConfirmSubmit,
	useMetadataDetails,
	useUserDetails,
	useUserMetadataDetails,
	useUserPreferences,
} from "~/lib/hooks";
import { useMetadataProgressUpdate, useReviewEntity } from "~/lib/state/media";
import classes from "~/styles/common.module.css";

export const PartialMetadataDisplay = (props: {
	metadataId: string;
	extraText?: string;
}) => {
	const { data: metadataDetails } = useQuery(
		getPartialMetadataDetailsQuery(props.metadataId),
	);
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
	);

	return (
		<Anchor
			component={Link}
			data-media-id={props.metadataId}
			to={$path("/media/item/:id", { id: props.metadataId })}
		>
			<Avatar
				imageProps={{ loading: "lazy" }}
				radius="sm"
				src={metadataDetails?.image}
				h={100}
				w={85}
				mx="auto"
				name={metadataDetails?.title}
				styles={{ image: { objectPosition: "top" } }}
			/>
			<Text
				mt={4}
				size="xs"
				ta="center"
				lineClamp={1}
				c={userMetadataDetails?.hasInteracted ? "yellow" : "dimmed"}
			>
				{metadataDetails?.title} {props.extraText}
			</Text>
		</Anchor>
	);
};

export const MediaScrollArea = (props: { children: ReactNode }) => {
	return (
		<ScrollArea.Autosize mah={MEDIA_DETAILS_HEIGHT}>
			{props.children}
		</ScrollArea.Autosize>
	);
};

export const MetadataDisplayItem = (props: {
	metadataId: string;
	name?: string;
	altName?: string;
	topRight?: ReactNode;
	rightLabel?: ReactNode;
	rightLabelHistory?: boolean;
	rightLabelLot?: boolean;
	noLeftLabel?: boolean;
}) => {
	const [_r, setEntityToReview] = useReviewEntity();
	const [_, setMetadataToUpdate, isMetadataToUpdateLoading] =
		useMetadataProgressUpdate();
	const userPreferences = useUserPreferences();
	const { ref, inViewport } = useInViewport();
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
	const reasons = userMetadataDetails?.mediaReason?.filter((r) =>
		[
			UserToMediaReason.Finished,
			UserToMediaReason.Watchlist,
			UserToMediaReason.Owned,
		].includes(r),
	);
	const hasInteracted = userMetadataDetails?.hasInteracted;

	return (
		<BaseMediaDisplayItem
			innerRef={ref}
			altName={props.altName}
			progress={currentProgress}
			isLoading={isMetadataDetailsLoading}
			name={props.name ?? metadataDetails?.title}
			imageUrl={metadataDetails?.assets.images.at(0)}
			highlightImage={userMetadataDetails?.recentlyConsumed}
			onImageClickBehavior={$path("/media/item/:id", { id: props.metadataId })}
			labels={
				metadataDetails
					? {
							left:
								props.noLeftLabel !== true
									? metadataDetails.publishYear
									: undefined,
							right:
								props.rightLabel ||
								(props.rightLabelLot
									? changeCase(snakeCase(metadataDetails.lot))
									: undefined) ||
								(props.rightLabelHistory ? (
									completedHistory.length > 0 ? (
										`${completedHistory.length} time${completedHistory.length === 1 ? "" : "s"}`
									) : null
								) : (
									<Text c={hasInteracted ? "yellow" : undefined}>
										{changeCase(snakeCase(metadataDetails.lot))}
									</Text>
								)),
						}
					: undefined
			}
			imageOverlay={{
				topRight: props.topRight ? (
					props.topRight
				) : averageRating ? (
					match(userPreferences.general.reviewScale)
						.with(UserReviewScale.ThreePointSmiley, () => (
							<DisplayThreePointReview rating={averageRating} />
						))
						.otherwise(() => (
							<Group gap={4}>
								<IconStarFilled size={12} style={{ color: reviewYellow }} />
								<Text c="white" size="xs" fw="bold" pr={4}>
									{Number(averageRating) % 1 === 0
										? Math.round(Number(averageRating)).toString()
										: Number(averageRating).toFixed(1)}
									{userPreferences.general.reviewScale ===
									UserReviewScale.OutOfFive
										? null
										: " %"}
								</Text>
							</Group>
						))
				) : (
					<IconStarFilled
						cursor="pointer"
						onClick={() => {
							if (metadataDetails)
								setEntityToReview({
									entityId: props.metadataId,
									entityLot: EntityLot.Metadata,
									metadataLot: metadataDetails.lot,
									entityTitle: metadataDetails.title,
								});
						}}
						size={18}
						className={classes.starIcon}
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
						variant="transparent"
						color="blue"
						size="compact-md"
						onClick={() =>
							setMetadataToUpdate({ metadataId: props.metadataId }, true)
						}
					>
						<IconPlayerPlay size={20} />
					</ActionIcon>
				),
			}}
		/>
	);
};

export const MetadataGroupDisplayItem = (props: {
	metadataGroupId: string;
	topRight?: ReactNode;
	rightLabel?: ReactNode;
	noLeftLabel?: boolean;
}) => {
	const { ref, inViewport } = useInViewport();
	const { data: metadataDetails, isLoading: isMetadataDetailsLoading } =
		useQuery({
			queryKey: queryFactory.media.metadataGroupDetails(props.metadataGroupId)
				.queryKey,
			queryFn: async () => {
				return clientGqlService
					.request(MetadataGroupDetailsDocument, props)
					.then((data) => data.metadataGroupDetails);
			},
			enabled: inViewport,
		});
	const { data: userMetadataGroupDetails } = useQuery({
		queryKey: queryFactory.media.userMetadataGroupDetails(props.metadataGroupId)
			.queryKey,
		queryFn: async () => {
			return clientGqlService
				.request(UserMetadataGroupDetailsDocument, props)
				.then((data) => data.userMetadataGroupDetails);
		},
		enabled: inViewport,
	});

	return (
		<BaseMediaDisplayItem
			innerRef={ref}
			isLoading={isMetadataDetailsLoading}
			name={metadataDetails?.details.title}
			imageOverlay={{ topRight: props.topRight }}
			highlightImage={userMetadataGroupDetails?.recentlyConsumed}
			onImageClickBehavior={$path("/media/groups/item/:id", {
				id: props.metadataGroupId,
			})}
			imageUrl={metadataDetails?.details.displayImages.at(0)}
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
}) => {
	const { ref, inViewport } = useInViewport();
	const { data: personDetails, isLoading: isPersonDetailsLoading } = useQuery({
		queryKey: queryFactory.media.personDetails(props.personId).queryKey,
		queryFn: async () => {
			return clientGqlService
				.request(PersonDetailsDocument, props)
				.then((data) => data.personDetails);
		},
		enabled: inViewport,
	});
	const { data: userPersonDetails } = useQuery({
		queryKey: queryFactory.media.userPersonDetails(props.personId).queryKey,
		queryFn: async () => {
			return clientGqlService
				.request(UserPersonDetailsDocument, props)
				.then((data) => data.userPersonDetails);
		},
		enabled: inViewport,
	});

	return (
		<BaseMediaDisplayItem
			innerRef={ref}
			name={personDetails?.details.name}
			isLoading={isPersonDetailsLoading}
			imageOverlay={{ topRight: props.topRight }}
			highlightImage={userPersonDetails?.recentlyConsumed}
			imageUrl={personDetails?.details.displayImages.at(0)}
			onImageClickBehavior={$path("/media/people/item/:id", {
				id: props.personId,
			})}
			labels={{
				left: personDetails
					? `${personDetails.contents.reduce((sum, content) => sum + content.items.length, 0)} items`
					: undefined,
				right: props.rightLabel,
			}}
		/>
	);
};

export const ToggleMediaMonitorMenuItem = (props: {
	entityLot: EntityLot;
	inCollections: Array<string>;
	formValue: string;
}) => {
	const isMonitored = props.inCollections.includes("Monitoring");
	const action = isMonitored
		? "removeEntityFromCollection"
		: "addEntityToCollection";
	const userDetails = useUserDetails();
	const submit = useConfirmSubmit();

	return (
		<Form
			replace
			method="POST"
			action={withQuery("/actions", { intent: action })}
		>
			<input hidden name="collectionName" defaultValue="Monitoring" />
			<input readOnly hidden name="entityId" value={props.formValue} />
			<input readOnly hidden name="entityLot" value={props.entityLot} />
			<input readOnly hidden name="creatorUserId" value={userDetails.id} />
			<Menu.Item
				type="submit"
				onClick={async (e) => {
					const form = e.currentTarget.form;
					if (form) {
						e.preventDefault();
						if (isMonitored) {
							const conf = await confirmWrapper({
								confirmation: "Are you sure you want to stop monitoring?",
							});
							if (conf) submit(form);
						} else {
							submit(form);
						}
					}
				}}
			>
				{isMonitored ? "Stop" : "Start"} monitoring
			</Menu.Item>
		</Form>
	);
};
