import { Carousel } from "@mantine/carousel";
import "@mantine/carousel/styles.css";
import {
	ActionIcon,
	Anchor,
	Badge,
	Box,
	Button,
	Flex,
	Image,
	Modal,
	Select,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Title,
	useComputedColorScheme,
} from "@mantine/core";
import { useDebouncedState, useDidUpdate } from "@mantine/hooks";
import { Form } from "@remix-run/react";
import type {
	EntityLot,
	MediaLot,
	MediaSource,
} from "@ryot/generated/graphql/backend/graphql";
import { groupBy, snakeCase } from "@ryot/ts-utils";
import { IconExternalLink, IconSearch, IconX } from "@tabler/icons-react";
import { type ReactNode, useRef } from "react";
import { useState } from "react";
import { withoutHost } from "ufo";
import events from "~/lib/events";
import { getFallbackImageUrl, redirectToQueryParam } from "~/lib/generals";
import { useSearchParam } from "~/lib/hooks";
import classes from "~/styles/common.module.css";

export const ApplicationGrid = (props: {
	children: ReactNode | ReactNode[];
}) => {
	return (
		<SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="lg">
			{props.children}
		</SimpleGrid>
	);
};

function getSurroundingElements<T>(array: T[], element: number): number[] {
	if (array.length === 1) return [0];
	const lastIndex = array.length - 1;
	if (element === 0) return [lastIndex, element, element + 1];
	if (element === lastIndex) return [element - 1, element, 0];
	return [element - 1, element, element + 1];
}

export const MediaDetailsLayout = (props: {
	children: ReactNode | (ReactNode | undefined)[];
	images: (string | null | undefined)[];
	externalLink?: {
		source: MediaSource;
		lot?: MediaLot;
		href?: string | null;
	};
}) => {
	const [activeImageId, setActiveImageId] = useState(0);
	const colorScheme = useComputedColorScheme("dark");

	return (
		<Flex direction={{ base: "column", md: "row" }} gap="lg">
			<Box
				id="images-container"
				pos="relative"
				className={classes.imagesContainer}
			>
				{props.images.length > 1 ? (
					<Carousel
						withIndicators={props.images.length > 1}
						w={300}
						onSlideChange={setActiveImageId}
					>
						{props.images.map((url, idx) => (
							<Carousel.Slide key={url} data-image-idx={idx}>
								{getSurroundingElements(props.images, activeImageId).includes(
									idx,
								) ? (
									<Image src={url} radius="lg" />
								) : null}
							</Carousel.Slide>
						))}
					</Carousel>
				) : (
					<Box w={300}>
						<Image
							src={props.images[0]}
							height={400}
							radius="lg"
							fallbackSrc={getFallbackImageUrl(colorScheme)}
						/>
					</Box>
				)}
				{props.externalLink ? (
					<Badge
						id="data-source"
						pos="absolute"
						size="lg"
						top={10}
						left={10}
						color="dark"
						variant="filled"
					>
						<Flex gap={4} align="center">
							<Text size="10">
								{snakeCase(props.externalLink.source)}
								{props.externalLink.lot
									? `:${snakeCase(props.externalLink.lot)}`
									: null}
							</Text>
							{props.externalLink.href ? (
								<Anchor href={props.externalLink.href} target="_blank" mt={2}>
									<IconExternalLink size={12.8} />
								</Anchor>
							) : null}
						</Flex>
					</Badge>
				) : null}
			</Box>
			<Stack id="details-container" style={{ flexGrow: 1 }}>
				{props.children}
			</Stack>
		</Flex>
	);
};

export const AddEntityToCollectionModal = (props: {
	userId: number;
	opened: boolean;
	onClose: () => void;
	entityId: string;
	entityLot: EntityLot;
	collections: {
		id: number;
		name: string;
		creatorUserId: number;
		creatorName: string;
	}[];
}) => {
	const selectData = Object.entries(
		groupBy(props.collections, (c) =>
			c.creatorUserId === props.userId ? "You" : c.creatorName,
		),
	).map(([g, items]) => ({
		group: g,
		items: items.map((c) => ({
			label: c.name,
			value: c.id.toString(),
		})),
	}));
	const [selectedCollection, setSelectedCollection] = useState<{
		id: string;
		name: string;
		creatorId: number;
	} | null>(null);

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Form action="/actions?intent=addEntityToCollection" method="post">
				<input readOnly hidden name="entityId" value={props.entityId} />
				<input readOnly hidden name="entityLot" value={props.entityLot} />
				{selectedCollection ? (
					<>
						<input
							readOnly
							hidden
							name="collectionName"
							value={selectedCollection.name}
						/>
						<input
							readOnly
							hidden
							name="creatorUserId"
							value={selectedCollection.creatorId}
						/>
					</>
				) : null}
				<HiddenLocationInput />
				<Stack>
					<Title order={3}>Select collection</Title>
					<Select
						searchable
						data={selectData}
						nothingFoundMessage="Nothing found..."
						value={selectedCollection?.id}
						onChange={(v) => {
							if (v) {
								const collection = props.collections.find(
									(c) => c.id === Number(v),
								);
								if (collection) {
									setSelectedCollection({
										id: v,
										name: collection.name,
										creatorId: collection.creatorUserId,
									});
								}
							}
						}}
					/>
					<Button
						disabled={!selectedCollection}
						variant="outline"
						type="submit"
						onClick={() => {
							events.addToCollection(props.entityLot);
							props.onClose();
						}}
					>
						Set
					</Button>
					<Button variant="outline" color="red" onClick={props.onClose}>
						Cancel
					</Button>
				</Stack>
			</Form>
		</Modal>
	);
};

export const HiddenLocationInput = () => {
	const value = withoutHost(
		typeof window !== "undefined" ? window.location.href : "",
	);

	return (
		<input type="hidden" name={redirectToQueryParam} value={value} readOnly />
	);
};

export const DebouncedSearchInput = (props: {
	initialValue?: string;
	queryParam?: string;
	placeholder?: string;
}) => {
	const [debouncedQuery, setDebouncedQuery] = useDebouncedState(
		props.initialValue || "",
		1000,
	);
	const [_, { setP }] = useSearchParam();

	useDidUpdate(
		() => setP(props.queryParam || "query", debouncedQuery),
		[debouncedQuery],
	);

	const ref = useRef<HTMLInputElement>(null);

	return (
		<TextInput
			ref={ref}
			name="query"
			placeholder={props.placeholder || "Search..."}
			leftSection={<IconSearch />}
			onChange={(e) => setDebouncedQuery(e.currentTarget.value)}
			defaultValue={debouncedQuery}
			style={{ flexGrow: 1 }}
			autoCapitalize="none"
			autoComplete="off"
			rightSection={
				debouncedQuery ? (
					<ActionIcon
						onClick={() => {
							if (ref.current) {
								ref.current.value = "";
								setDebouncedQuery("");
							}
						}}
					>
						<IconX size={16} />
					</ActionIcon>
				) : null
			}
		/>
	);
};
