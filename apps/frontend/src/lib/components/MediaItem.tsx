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
import {
	Anchor,
	Button,
	Flex,
	Image,
	Indicator,
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
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/router";

type Item = MediaSearchQuery["mediaSearch"]["items"][number]["item"];

export const MediaItemWithoutUpdateModal = (props: {
	item: Item;
	lot: MetadataLot;
	children?: JSX.Element;
	imageOverlayForLoadingIndicator?: boolean;
	href: string;
	listType: "grid" | "poster";
	existsInDatabase?: boolean;
}) => {
	return (
		<Flex
			key={props.item.identifier}
			align="center"
			justify={props.listType === "poster" ? "center" : "start"}
			direction={props.listType === "poster" ? "column" : "row"}
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
				<Anchor style={{ flex: "none" }}>
					<Image
						src={props.item.images.at(0)}
						radius={"md"}
						height={props.listType === "poster" ? 250 : 150}
						width={props.listType === "poster" ? 167 : 100}
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
			<Flex
				w={props.listType === "poster" ? "100%" : undefined}
				direction={props.listType === "poster" ? "column" : "column-reverse"}
				ml={props.listType === "grid" ? "md" : 0}
			>
				<Flex
					justify={"space-between"}
					direction={props.listType === "poster" ? "row" : "column"}
					w="100%"
				>
					<Text c="dimmed">{props.item.publishYear}</Text>
					<Tooltip
						label="This media exists in the database"
						disabled={!props.existsInDatabase}
					>
						<Indicator
							inline
							color="violet"
							disabled={!props.existsInDatabase}
							position="middle-start"
							offset={-10}
						>
							<Text c="dimmed">{changeCase(props.lot)}</Text>
						</Indicator>
					</Tooltip>
				</Flex>
				<Text
					w="100%"
					truncate={props.listType === "poster" ? true : undefined}
					fw={"bold"}
					mb="xs"
				>
					{props.item.title}
				</Text>
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
	refetch: () => void;
	maybeItemId?: number;
	listType: "grid" | "poster";
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
		});
		return id;
	};

	return (
		<MediaItemWithoutUpdateModal
			listType={props.listType}
			item={props.item}
			lot={props.lot}
			imageOverlayForLoadingIndicator={commitMedia.isLoading}
			href={
				props.maybeItemId
					? `${ROUTES.media.details}?item=${props.maybeItemId}`
					: `${ROUTES.media.commit}?identifier=${props.item.identifier}&lot=${props.lot}`
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
					disabled={addMediaToCollection.isLoading}
				>
					Add to Watchlist
				</Button>
			</>
		</MediaItemWithoutUpdateModal>
	);
}
