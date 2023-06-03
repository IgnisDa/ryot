import { ROUTES } from "../constants";
import { useCommitMedia } from "@/lib/hooks/graphql";
import { gqlClient } from "@/lib/services/api";
import {
	Verb,
	changeCase,
	getInitials,
	getLot,
	getVerb,
} from "@/lib/utilities";
import { Anchor, Button, Flex, Image, Loader, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	AddMediaToCollectionDocument,
	type AddMediaToCollectionMutationVariables,
	type BooksSearchQuery,
	MediaExistsInDatabaseDocument,
	MetadataLot,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/router";

type Item = BooksSearchQuery["booksSearch"]["items"][number];

export const MediaItemWithoutUpdateModal = (props: {
	item: Item;
	lot: MetadataLot;
	children?: JSX.Element;
	imageOverlayForLoadingIndicator?: boolean;
	href: string;
}) => {
	return (
		<Flex
			key={props.item.identifier}
			align={"center"}
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
				<Anchor>
					<Image
						src={props.item.images.at(0)}
						radius={"md"}
						height={250}
						withPlaceholder
						placeholder={<Text size={60}>{getInitials(props.item.title)}</Text>}
						style={{ cursor: "pointer" }}
						alt={`Image for ${props.item.title}`}
						sx={(_t) => ({
							":hover": { transform: "scale(1.02)" },
							transitionProperty: "transform",
							transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
							transitionDuration: "150ms",
						})}
					/>
				</Anchor>
			</Link>
			<Flex justify={"space-between"} w="100%">
				<Text c="dimmed">{props.item.publishYear}</Text>
				<Text c="dimmed">{changeCase(props.lot)}</Text>
			</Flex>
			<Text w="100%" truncate fw={"bold"} mb="xs">
				{props.item.title}
			</Text>
			{props.children}
		</Flex>
	);
};

export default function (props: {
	item: Item;
	idx: number;
	query: string;
	offset: number;
	lot: MetadataLot;
	refetch: () => void;
}) {
	const router = useRouter();
	const lot = getLot(router.query.lot);

	const commitMedia = useCommitMedia(lot);
	const mediaExistsInDatabase = useQuery({
		queryKey: ["mediaExistsInDatabase", props.idx],
		queryFn: async () => {
			const { mediaExistsInDatabase } = await gqlClient.request(
				MediaExistsInDatabaseDocument,
				{
					identifier: props.item.identifier,
					lot: props.lot,
				},
			);
			return mediaExistsInDatabase;
		},
	});
	const addMediaToCollection = useMutation({
		mutationFn: async (variables: AddMediaToCollectionMutationVariables) => {
			const { addMediaToCollection } = await gqlClient.request(
				AddMediaToCollectionDocument,
				variables,
			);
			return addMediaToCollection;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "Media added to watchlist successfully",
			});
		},
	});

	const commitFunction = async () => {
		const { id } = await commitMedia.mutateAsync({
			identifier: props.item.identifier,
		});
		return id;
	};

	return (
		<MediaItemWithoutUpdateModal
			item={props.item}
			lot={props.lot}
			imageOverlayForLoadingIndicator={
				commitMedia.isLoading || mediaExistsInDatabase.isLoading
			}
			href={
				mediaExistsInDatabase.data
					? `${ROUTES.media.details}?item=${mediaExistsInDatabase.data}`
					: `${ROUTES.media.commit}?identifier=${props.item.identifier}&lot=${props.lot}`
			}
		>
			<>
				{props.lot !== MetadataLot.Show ? (
					<Button
						variant="outline"
						w="100%"
						compact
						onClick={async () => {
							const id = await commitFunction();
							router.push(`${ROUTES.media.updateProgress}?item=${id}`);
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
								router.push(`${ROUTES.media.details}?item=${id}`);
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
				>
					Add to Watchlist
				</Button>
			</>
		</MediaItemWithoutUpdateModal>
	);
}
