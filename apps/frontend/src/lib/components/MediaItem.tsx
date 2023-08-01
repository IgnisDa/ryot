import { APP_ROUTES } from "@/lib/constants";
import { useCommitMedia, useUser } from "@/lib/hooks/graphql";
import { gqlClient } from "@/lib/services/api";
import { Verb, getLot, getVerb } from "@/lib/utilities";
import {
	ActionIcon,
	Anchor,
	Avatar,
	Box,
	Button,
	Collapse,
	Flex,
	Image,
	Loader,
	ScrollArea,
	Text,
	Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	AddMediaToCollectionDocument,
	type AddMediaToCollectionMutationVariables,
	type MediaSearchQuery,
	MetadataLot,
	MetadataSource,
	type ReviewItem,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, getInitials } from "@ryot/utilities";
import { IconEdit, IconStarFilled } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Link from "next/link";
import { useRouter } from "next/router";
import { withQuery } from "ufo";

export const MediaScrollArea = (props: { children: JSX.Element }) => {
	return <ScrollArea.Autosize mah={300}>{props.children}</ScrollArea.Autosize>;
};

export const ReviewItemDisplay = ({
	review,
	metadataId,
	creatorId,
}: {
	review: ReviewItem;
	metadataId?: number;
	creatorId?: number;
}) => {
	const [opened, { toggle }] = useDisclosure(false);
	const user = useUser();

	return (
		<Box key={review.id} data-review-id={review.id}>
			<Flex align={"center"} gap={"sm"}>
				<Avatar color="cyan" radius="xl">
					{getInitials(review.postedBy.name)}{" "}
				</Avatar>
				<Box>
					<Text>{review.postedBy.name}</Text>
					<Text>{DateTime.fromJSDate(review.postedOn).toLocaleString()}</Text>
				</Box>
				{user && user.id === review.postedBy.id ? (
					<Link
						href={withQuery(APP_ROUTES.media.individualMediaItem.postReview, {
							metadataId,
							creatorId,
							reviewId: review.id,
						})}
						passHref
						legacyBehavior
					>
						<Anchor>
							<ActionIcon>
								<IconEdit size="1rem" />
							</ActionIcon>
						</Anchor>
					</Link>
				) : null}
			</Flex>
			<Box ml={"sm"} mt={"xs"}>
				{typeof review.showSeason === "number" ? (
					<Text color="dimmed">
						S{review.showSeason}-E
						{review.showEpisode}
					</Text>
				) : null}
				{typeof review.podcastEpisode === "number" ? (
					<Text color="dimmed">EP-{review.podcastEpisode}</Text>
				) : null}
				{review.rating > 0 ? (
					<Flex align={"center"} gap={4}>
						<IconStarFilled size={"1rem"} style={{ color: "#EBE600FF" }} />
						<Text color="white" fw="bold">
							{review.rating} %
						</Text>
					</Flex>
				) : null}
				{review.text ? (
					!review.spoiler ? (
						<Text dangerouslySetInnerHTML={{ __html: review.text }} />
					) : (
						<>
							{!opened ? (
								<Button onClick={toggle} variant={"subtle"} compact>
									Show spoiler
								</Button>
							) : null}
							<Collapse in={opened}>
								<Text dangerouslySetInnerHTML={{ __html: review.text }} />
							</Collapse>
						</>
					)
				) : null}
			</Box>
		</Box>
	);
};

export const BaseDisplayItem = (props: {
	name: string;
	imageLink?: string | null;
	imagePlaceholder: string;
	topRight?: JSX.Element;
	topLeft?: JSX.Element;
	bottomLeft?: string | number | null;
	bottomRight?: string | number | null;
	href: string;
	highlightRightText?: string;
	children?: JSX.Element;
}) => {
	return (
		<Flex
			key={`${props.bottomLeft}-${props.bottomRight}-${props.name}`}
			align="center"
			justify={"center"}
			direction={"column"}
			pos={"relative"}
		>
			{props.topLeft}
			<Link passHref legacyBehavior href={props.href}>
				<Anchor style={{ flex: "none" }} pos="relative">
					<Image
						imageProps={{ loading: "lazy" }}
						src={props.imageLink}
						radius={"md"}
						height={250}
						width={167}
						withPlaceholder
						placeholder={<Text size={60}>{props.imagePlaceholder}</Text>}
						style={{ cursor: "pointer" }}
						alt={`Image for ${props.name}`}
						sx={(_t) => ({
							":hover": { boxShadow: "0 0 15px black" },
							transitionProperty: "transform",
							transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
							transitionDuration: "150ms",
						})}
					/>
					{props.topRight}
				</Anchor>
			</Link>
			<Flex w={"100%"} direction={"column"}>
				<Flex justify={"space-between"} direction={"row"} w="100%">
					<Text c="dimmed">{props.bottomLeft}</Text>
					<Tooltip
						label={props.highlightRightText}
						disabled={props.highlightRightText ? false : true}
						position="right"
					>
						<Text c={props.highlightRightText ? "yellow" : "dimmed"}>
							{props.bottomRight}
						</Text>
					</Tooltip>
				</Flex>
				<Tooltip label={props.name} position="right">
					<Text w="100%" truncate fw={"bold"} mb="xs">
						{props.name}
					</Text>
				</Tooltip>
				{props.children}
			</Flex>
		</Flex>
	);
};

type Item = MediaSearchQuery["mediaSearch"]["items"][number]["item"];

export const MediaItemWithoutUpdateModal = (props: {
	item: Item;
	lot: MetadataLot;
	children?: JSX.Element;
	imageOverlayForLoadingIndicator?: boolean;
	href: string;
	existsInDatabase?: boolean;
	averageRating?: number;
}) => {
	return (
		<BaseDisplayItem
			href={props.href}
			imageLink={props.item.image}
			imagePlaceholder={getInitials(props.item?.title || "")}
			topLeft={
				props.imageOverlayForLoadingIndicator ? (
					<Loader
						pos={"absolute"}
						style={{ zIndex: 999 }}
						top={10}
						left={10}
						color="red"
						variant="bars"
						size="sm"
					/>
				) : undefined
			}
			topRight={
				props.averageRating ? (
					<Box
						p={2}
						pos={"absolute"}
						top={5}
						right={5}
						style={{
							backgroundColor: "rgba(0, 0, 0, 0.75)",
							borderRadius: 3,
						}}
					>
						<Flex align={"center"} gap={4}>
							<IconStarFilled size={"0.8rem"} style={{ color: "#EBE600FF" }} />
							<Text color="white" size="xs" fw="bold">
								{props.averageRating} %
							</Text>
						</Flex>
					</Box>
				) : undefined
			}
			bottomLeft={props.item.publishYear}
			bottomRight={changeCase(props.lot || "")}
			highlightRightText={
				props.existsInDatabase ? "This media exists in the database" : undefined
			}
			name={props.item.title}
			children={props.children}
		/>
	);
};

export default function (props: {
	item: Item;
	idx: number;
	query: string;
	offset: number;
	lot: MetadataLot;
	source: MetadataSource;
	searchQueryRefetch: () => void;
	maybeItemId?: number;
}) {
	const router = useRouter();
	const lot = getLot(router.query.lot);

	const commitMedia = useCommitMedia(lot);
	const addMediaToCollection = useMutation({
		mutationFn: async (variables: AddMediaToCollectionMutationVariables) => {
			const { addMediaToCollection } = await gqlClient.request(
				AddMediaToCollectionDocument,
				variables,
			);
			return addMediaToCollection;
		},
		onSuccess: () => {
			props.searchQueryRefetch();
			notifications.show({
				title: "Success",
				message: "Media added to watchlist successfully",
			});
		},
	});

	const commitFunction = async () => {
		const { id } = await commitMedia.mutateAsync({
			identifier: props.item.identifier,
			lot: props.lot,
			source: props.source,
		});
		props.searchQueryRefetch();
		return id;
	};

	return (
		<MediaItemWithoutUpdateModal
			item={props.item}
			lot={props.lot}
			imageOverlayForLoadingIndicator={commitMedia.isLoading}
			href={
				props.maybeItemId
					? withQuery(APP_ROUTES.media.individualMediaItem.details, {
							id: props.maybeItemId,
					  })
					: withQuery(APP_ROUTES.media.individualMediaItem.commit, {
							identifier: props.item.identifier,
							lot: props.lot,
							source: props.source,
					  })
			}
			existsInDatabase={!!props.maybeItemId}
		>
			<>
				{props.lot !== MetadataLot.Show ? (
					<Button
						variant="outline"
						w="100%"
						compact
						onClick={async () => {
							const id = await commitFunction();
							const nextPath = withQuery(router.pathname, router.query);
							router.push(
								withQuery(APP_ROUTES.media.individualMediaItem.updateProgress, {
									id,
									next: nextPath,
								}),
							);
						}}
					>
						Mark as {getVerb(Verb.Read, props.lot)}
					</Button>
				) : (
					<>
						<Button
							variant="outline"
							w="100%"
							compact
							onClick={async () => {
								const id = await commitFunction();
								router.push(
									withQuery(APP_ROUTES.media.individualMediaItem.details, {
										id,
									}),
								);
							}}
						>
							Show details
						</Button>
					</>
				)}
				<Button
					mt="xs"
					variant="outline"
					w="100%"
					compact
					onClick={async () => {
						const id = await commitFunction();
						addMediaToCollection.mutate({
							input: { collectionName: "Watchlist", mediaId: id },
						});
					}}
					disabled={addMediaToCollection.isLoading}
				>
					Add to Watchlist
				</Button>
			</>
		</MediaItemWithoutUpdateModal>
	);
}
