import { ROUTES } from "@/lib/constants";
import { useCommitMedia } from "@/lib/hooks/graphql";
import { gqlClient } from "@/lib/services/api";
import {
	Verb,
	changeCase,
	getInitials,
	getLot,
	getVerb,
} from "@/lib/utilities";
import {
	Anchor,
	Box,
	Button,
	Flex,
	Image,
	Loader,
	Text,
	Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	AddMediaToCollectionDocument,
	type AddMediaToCollectionMutationVariables,
	type MediaSearchQuery,
	MetadataLot,
	MetadataSource,
} from "@ryot/generated/graphql/backend/graphql";
import { IconStarFilled } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/router";
import { withQuery } from "ufo";

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
		<Flex
			key={props.item.identifier}
			align="center"
			justify={"center"}
			direction={"column"}
			pos={"relative"}
		>
			{props.imageOverlayForLoadingIndicator ? (
				<Loader
					pos={"absolute"}
					style={{ zIndex: 999 }}
					top={10}
					left={10}
					color="red"
					variant="bars"
					size="sm"
				/>
			) : null}
			<Link passHref legacyBehavior href={props.href}>
				<Anchor style={{ flex: "none" }} pos="relative">
					<Image
						src={props.item.images.at(0)}
						radius={"md"}
						height={250}
						width={167}
						withPlaceholder
						placeholder={<Text size={60}>{getInitials(props.item.title)}</Text>}
						style={{ cursor: "pointer" }}
						alt={`Image for ${props.item.title}`}
						sx={(_t) => ({
							":hover": { boxShadow: "0 0 15px black" },
							transitionProperty: "transform",
							transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
							transitionDuration: "150ms",
						})}
					/>
					{props.averageRating ? (
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
								<IconStarFilled
									size={"0.8rem"}
									style={{ color: "#EBE600FF" }}
								/>
								<Text color="white" size="xs">
									{(+props.averageRating).toFixed(1)}
								</Text>
							</Flex>
						</Box>
					) : null}
				</Anchor>
			</Link>
			<Flex w={"100%"} direction={"column"}>
				<Flex justify={"space-between"} direction={"row"} w="100%">
					<Text c="dimmed">{props.item.publishYear}</Text>
					<Tooltip
						label="This media exists in the database"
						disabled={!props.existsInDatabase}
						position="right"
					>
						<Text c={props.existsInDatabase ? "yellow" : "dimmed"}>
							{changeCase(props.lot)}
						</Text>
					</Tooltip>
				</Flex>
				<Tooltip label={props.item.title} position="right">
					<Text w="100%" truncate fw={"bold"} mb="xs">
						{props.item.title}
					</Text>
				</Tooltip>
				{props.children}
			</Flex>
		</Flex>
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
					? `${ROUTES.media.details}?item=${props.maybeItemId}`
					: `${ROUTES.media.commit}?identifier=${props.item.identifier}&lot=${props.lot}&source=${props.source}`
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
								withQuery(ROUTES.media.updateProgress, {
									item: id,
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
									withQuery(ROUTES.media.details, {
										item: id,
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
