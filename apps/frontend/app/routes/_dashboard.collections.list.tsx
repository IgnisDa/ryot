import {
	ActionIcon,
	Anchor,
	Box,
	Checkbox,
	Container,
	Flex,
	Group,
	Image,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useDidUpdate, useHover, useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	CollectionContentsDocument,
	CollectionContentsSortBy,
	DeleteCollectionDocument,
	EntityLot,
	GraphqlSortOrder,
	type UserCollectionsListQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { truncate } from "@ryot/ts-utils";
import { IconEdit, IconPlus, IconTrashFilled } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseAsBoolean, parseAsString } from "nuqs";
import { Link } from "react-router";
import { Virtuoso } from "react-virtuoso";
import { $path } from "safe-routes";
import {
	DisplayListDetailsAndRefresh,
	ProRequiredAlert,
} from "~/components/common";
import { DebouncedSearchInput } from "~/components/common/filters";
import { useFiltersState } from "~/lib/hooks/filters/use-state";
import {
	useCoreDetails,
	useFallbackImageUrl,
	useUserCollections,
	useUserDetails,
} from "~/lib/shared/hooks";
import {
	clientGqlService,
	getMetadataDetailsQuery,
	queryClient,
	queryFactory,
} from "~/lib/shared/react-query";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import { useCreateOrUpdateCollectionModal } from "~/lib/state/collection";

export const meta = () => {
	return [{ title: "Your collections | Ryot" }];
};

const defaultSearchFilters = {
	query: parseAsString.withDefault(""),
	showHidden: parseAsBoolean.withDefault(false),
};

export default function Page() {
	const userDetails = useUserDetails();
	const collections = useUserCollections();
	const { open: openCollectionModal } = useCreateOrUpdateCollectionModal();
	const { filters: searchFilters, updateFilters } =
		useFiltersState(defaultSearchFilters);

	const query = searchFilters.query;
	const showHidden = searchFilters.showHidden;
	const hasHiddenCollections = collections.some(
		(c) =>
			c.collaborators.find((c) => c.collaborator.id === userDetails.id)
				?.extraInformation?.isHidden,
	);

	const filteredCollections = collections
		.filter((c) =>
			showHidden
				? true
				: c.collaborators.find((c) => c.collaborator.id === userDetails.id)
						?.extraInformation?.isHidden !== true,
		)
		.filter((c) =>
			query ? c.name.toLowerCase().includes(query.toLowerCase()) : true,
		);

	return (
		<Container size="sm">
			<Stack>
				<Group justify="space-between" wrap="nowrap">
					<Flex align="center" gap="md">
						<Title>Your collections</Title>
						<ActionIcon
							color="green"
							variant="outline"
							onClick={() => openCollectionModal(null)}
						>
							<IconPlus size={20} />
						</ActionIcon>
					</Flex>
				</Group>
				<DebouncedSearchInput
					value={query}
					placeholder="Search collections"
					onChange={(value) => updateFilters({ query: value })}
				/>
				<Group justify="space-between" align="center">
					<DisplayListDetailsAndRefresh total={filteredCollections.length} />
					{hasHiddenCollections ? (
						<Checkbox
							size="sm"
							name="showHidden"
							label="Show hidden"
							checked={showHidden}
							onChange={(e) => updateFilters({ showHidden: e.target.checked })}
						/>
					) : null}
				</Group>
				<Virtuoso
					style={{ height: "80vh" }}
					data={filteredCollections}
					itemContent={(index) => {
						const c = filteredCollections[index];
						return (
							<DisplayCollection key={c.id} index={index} collection={c} />
						);
					}}
				/>
			</Stack>
		</Container>
	);
}

type Collection =
	UserCollectionsListQuery["userCollectionsList"]["response"][number];

const IMAGES_CONTAINER_WIDTH = 250;

const DisplayCollection = (props: {
	index: number;
	collection: Collection;
}) => {
	const userDetails = useUserDetails();
	const coreDetails = useCoreDetails();
	const fallbackImageUrl = useFallbackImageUrl(props.collection.name);
	const { open: openCollectionModal } = useCreateOrUpdateCollectionModal();
	const additionalDisplay = [];

	const deleteCollectionMutation = useMutation({
		mutationFn: async (collectionName: string) => {
			const { deleteCollection } = await clientGqlService.request(
				DeleteCollectionDocument,
				{ collectionName },
			);
			return deleteCollection;
		},
		onSuccess: () => {
			notifications.show({
				color: "green",
				title: "Success",
				message: "Collection deleted",
			});
			queryClient.invalidateQueries({
				queryKey: queryFactory.collections.userCollectionsList().queryKey,
			});
		},
		onError: () => {
			notifications.show({
				color: "red",
				title: "Error",
				message: "Cannot delete a default collection",
			});
		},
	});

	const { data: collectionImages } = useQuery({
		queryKey: queryFactory.collections.collectionDetailsImages(
			props.collection.id,
		).queryKey,
		queryFn: async () => {
			const { collectionContents } = await clientGqlService.request(
				CollectionContentsDocument,
				{
					input: {
						search: { take: 10 },
						collectionId: props.collection.id,
						sort: {
							order: GraphqlSortOrder.Desc,
							by: CollectionContentsSortBy.LastUpdatedOn,
						},
					},
				},
			);
			const images = [];
			for (const content of collectionContents.response.results.items) {
				if (images.length === 5) break;
				if (content.entityLot !== EntityLot.Metadata) continue;
				const { assets } = await queryClient.ensureQueryData(
					getMetadataDetailsQuery(content.entityId),
				);
				if (assets.remoteImages.length > 0) images.push(assets.remoteImages[0]);
			}
			return images;
		},
	});

	const [hoveredStates, setHoveredStates] = useListState<boolean>([]);

	const setHoveredState = (index: number, state: boolean) => {
		setHoveredStates.setItem(index, state);
	};

	const currentlyHovered = hoveredStates.findIndex((h) => h);

	if (props.collection.creator.id !== userDetails.id)
		additionalDisplay.push(`By ${props.collection.creator.name}`);
	if (props.collection.count > 0)
		additionalDisplay.push(`${props.collection.count} items`);
	if (props.collection.collaborators.length > 1)
		additionalDisplay.push(
			`${props.collection.collaborators.length - 1} collaborators`,
		);

	const FallBackImage = () => (
		<Image src={fallbackImageUrl} h="100%" flex="none" mx="auto" radius="md" />
	);

	return (
		<Paper
			pr="md"
			radius="lg"
			withBorder
			pl={{ base: "md", md: 0 }}
			py={{ base: "sm", md: 0 }}
			style={{ overflow: "hidden" }}
			mt={props.index !== 0 ? "lg" : undefined}
		>
			<Flex gap="xs" direction={{ base: "column", md: "row" }}>
				<Flex
					h={180}
					pos="relative"
					style={{ overflow: "hidden" }}
					w={{ md: IMAGES_CONTAINER_WIDTH }}
				>
					{coreDetails.isServerKeyValidated ? (
						collectionImages && collectionImages.length > 0 ? (
							collectionImages.map((image, index) => {
								const shouldCollapse = index < currentlyHovered;
								return (
									<CollectionImageDisplay
										key={image}
										image={image}
										index={index}
										shouldCollapse={shouldCollapse}
										setHoveredState={setHoveredState}
										totalImages={collectionImages.length}
									/>
								);
							})
						) : (
							<FallBackImage />
						)
					) : (
						<>
							<FallBackImage />
							<Box pos="absolute" left={0} right={0} bottom={0}>
								<ProRequiredAlert tooltipLabel="Collage image using collection contents" />
							</Box>
						</>
					)}
				</Flex>
				<Stack flex={1} py={{ md: "sm" }}>
					<Group justify="space-between">
						<Anchor
							component={Link}
							to={$path("/collections/:id", { id: props.collection.id })}
						>
							<Title order={4}>
								{truncate(props.collection.name, { length: 20 })}
							</Title>
						</Anchor>
						<Group gap="md">
							{additionalDisplay.length > 0 ? (
								<Text c="dimmed" size="xs">
									({additionalDisplay.join(", ")})
								</Text>
							) : null}
							{userDetails.id === props.collection.creator.id ? (
								<ActionIcon
									color="blue"
									variant="outline"
									onClick={() => {
										openCollectionModal({
											collectionId: props.collection.id,
										});
									}}
								>
									<IconEdit size={18} />
								</ActionIcon>
							) : null}
							{userDetails.id === props.collection.creator.id &&
							!props.collection.isDefault ? (
								<ActionIcon
									color="red"
									variant="outline"
									loading={deleteCollectionMutation.isPending}
									onClick={() => {
										openConfirmationModal(
											"Are you sure you want to delete this collection?",
											() =>
												deleteCollectionMutation.mutate(props.collection.name),
										);
									}}
								>
									<IconTrashFilled size={18} />
								</ActionIcon>
							) : null}
						</Group>
					</Group>
					{props.collection.description ? (
						<Text size="xs" lineClamp={5}>
							{props.collection.description}
						</Text>
					) : null}
					{props.collection.isDefault ? (
						<Text lineClamp={1} mt="auto" ta="right" c="dimmed" size="xs">
							System created
							{props.collection.collaborators.find(
								(c) => c.collaborator.id === userDetails.id,
							)?.extraInformation?.isHidden
								? ", Hidden"
								: ""}
						</Text>
					) : null}
				</Stack>
			</Flex>
		</Paper>
	);
};

const CollectionImageDisplay = (props: {
	image: string;
	index: number;
	totalImages: number;
	shouldCollapse: boolean;
	setHoveredState: (index: number, state: boolean) => void;
}) => {
	const { ref, hovered } = useHover();
	const offset = IMAGES_CONTAINER_WIDTH / props.totalImages - 20;

	useDidUpdate(() => {
		props.setHoveredState(props.index, hovered);
	}, [hovered]);

	return (
		<Box
			h="100%"
			w="120px"
			ref={ref}
			top={{ md: 0 }}
			pos={{ md: "absolute" }}
			left={{
				md: props.index * offset - (props.shouldCollapse ? offset * 2 : 0),
			}}
			style={{
				zIndex: props.totalImages - props.index,
				transitionProperty: "left",
				transitionDuration: "0.2s",
				transitionTimingFunction: "ease-in-out",
			}}
		>
			<Image src={props.image} h="100%" />
		</Box>
	);
};
