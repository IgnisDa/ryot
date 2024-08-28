import {
	ActionIcon,
	Anchor,
	Avatar,
	Box,
	Center,
	Flex,
	Group,
	Image,
	Loader,
	type MantineStyleProp,
	Menu,
	ScrollArea,
	Skeleton,
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
	UserReviewScale,
	UserToMediaReason,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials, isString, snakeCase } from "@ryot/ts-utils";
import {
	IconBackpack,
	IconBookmarks,
	IconCloudDownload,
	IconPlayerPlay,
	IconRosetteDiscountCheck,
	IconStarFilled,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode, Ref } from "react";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { MEDIA_DETAILS_HEIGHT } from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import {
	clientGqlService,
	getPartialMetadataDetailsQuery,
	queryFactory,
} from "~/lib/generals";
import {
	useConfirmSubmit,
	useFallbackImageUrl,
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

const blackBgStyles = {
	backgroundColor: "rgba(0, 0, 0, 0.75)",
	borderRadius: 3,
	padding: 2,
} satisfies MantineStyleProp;

export const BaseMediaDisplayItem = (props: {
	isLoading: boolean;
	name?: string;
	altName?: string;
	imageUrl?: string | null;
	imageOverlay?: {
		topRight?: ReactNode;
		topLeft?: ReactNode;
		bottomRight?: ReactNode;
		bottomLeft?: ReactNode;
	};
	labels?: { right?: ReactNode; left?: ReactNode };
	onImageClickBehavior: string | (() => Promise<void>);
	nameRight?: ReactNode;
	innerRef?: Ref<HTMLDivElement>;
}) => {
	const SurroundingElement = (iProps: { children: ReactNode }) =>
		isString(props.onImageClickBehavior) ? (
			<Anchor component={Link} to={props.onImageClickBehavior}>
				{iProps.children}
			</Anchor>
		) : (
			<Box onClick={props.onImageClickBehavior}>{iProps.children}</Box>
		);
	const defaultOverlayProps = {
		style: { zIndex: 10, ...blackBgStyles },
		pos: "absolute",
	} as const;

	return (
		<Flex justify="space-between" direction="column" ref={props.innerRef}>
			<Box pos="relative" w="100%">
				<SurroundingElement>
					<Tooltip label={props.name} position="top">
						<Image
							src={props.imageUrl}
							radius="md"
							style={{ cursor: "pointer", height: 260, w: 170 }}
							alt={`Image for ${props.name}`}
							className={classes.mediaImage}
							styles={{
								root: {
									transitionProperty: "transform",
									transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
									transitionDuration: "150ms",
								},
							}}
							fallbackSrc={useFallbackImageUrl(
								props.isLoading
									? "Loading..."
									: props.name
										? getInitials(props.name)
										: undefined,
							)}
						/>
					</Tooltip>
				</SurroundingElement>
				{props.imageOverlay?.topLeft ? (
					<Center top={5} left={5} {...defaultOverlayProps}>
						{props.imageOverlay.topLeft}
					</Center>
				) : null}
				{props.imageOverlay?.topRight ? (
					<Center top={5} right={5} {...defaultOverlayProps}>
						{props.imageOverlay.topRight}
					</Center>
				) : null}
				{props.imageOverlay?.bottomLeft ? (
					<Center bottom={5} left={5} {...defaultOverlayProps}>
						{props.imageOverlay.bottomLeft}
					</Center>
				) : null}
				{props.imageOverlay?.bottomRight ? (
					<Center bottom={5} right={5} {...defaultOverlayProps}>
						{props.imageOverlay.bottomRight}
					</Center>
				) : null}
			</Box>
			{props.isLoading ? (
				<>
					<Skeleton height={22} mt={10} />
					<Skeleton height={22} mt={8} />
				</>
			) : (
				<Flex w="100%" direction="column" px={{ base: 10, md: 3 }} pt={4}>
					<Flex justify="space-between" direction="row" w="100%">
						<Text c="dimmed" size="sm">
							{props.labels?.left}
						</Text>
						<Text c="dimmed" size="sm">
							{props.labels?.right}
						</Text>
					</Flex>
					<Flex justify="space-between" align="center" mb="xs">
						<Text w="100%" truncate fw="bold">
							{props.altName ?? props.name}
						</Text>
						{props.nameRight}
					</Flex>
				</Flex>
			)}
		</Flex>
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
		useQuery({
			...getPartialMetadataDetailsQuery(props.metadataId),
			enabled: inViewport,
		});
	const { data: userMetadataDetails } = useUserMetadataDetails(
		props.metadataId,
		inViewport,
	);
	const averageRating = userMetadataDetails?.averageRating;
	const history = (userMetadataDetails?.history || []).filter(
		(h) => h.state === SeenState.Completed,
	);
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
			name={props.name ?? metadataDetails?.title}
			altName={props.altName}
			isLoading={isMetadataDetailsLoading}
			onImageClickBehavior={$path("/media/item/:id", { id: props.metadataId })}
			imageUrl={metadataDetails?.image}
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
									history.length > 0 ? (
										`${history.length} time${history.length === 1 ? "" : "s"}`
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
					<Group gap={4}>
						<IconStarFilled size={12} style={{ color: "#EBE600FF" }} />
						<Text c="white" size="xs" fw="bold" pr={4}>
							{Number(averageRating) % 1 === 0
								? Math.round(Number(averageRating)).toString()
								: Number(averageRating).toFixed(1)}
							{userPreferences.general.reviewScale === UserReviewScale.OutOfFive
								? null
								: " %"}
						</Text>
					</Group>
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
						size={16}
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

	return (
		<BaseMediaDisplayItem
			innerRef={ref}
			name={metadataDetails?.details.title}
			isLoading={isMetadataDetailsLoading}
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
			imageOverlay={{ topRight: props.topRight }}
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

	return (
		<BaseMediaDisplayItem
			innerRef={ref}
			name={personDetails?.details.name}
			isLoading={isPersonDetailsLoading}
			onImageClickBehavior={$path("/media/people/item/:id", {
				id: props.personId,
			})}
			imageUrl={personDetails?.details.displayImages.at(0)}
			labels={{
				left: personDetails
					? `${personDetails.contents.reduce((sum, content) => sum + content.items.length, 0)} items`
					: undefined,
				right: props.rightLabel,
			}}
			imageOverlay={{ topRight: props.topRight }}
		/>
	);
};

export const MediaIsPartial = (props: { mediaType: string }) => {
	return (
		<Flex align="center" gap={4}>
			<IconCloudDownload size={20} />
			<Text size="xs">
				Details of this {props.mediaType} are being downloaded
			</Text>
		</Flex>
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
				color={isMonitored ? "red" : undefined}
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
