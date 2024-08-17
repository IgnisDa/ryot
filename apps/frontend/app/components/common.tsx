import { Carousel } from "@mantine/carousel";
import "@mantine/carousel/styles.css";
import {
	ActionIcon,
	Alert,
	Anchor,
	Badge,
	Box,
	Flex,
	Group,
	Image,
	Modal,
	MultiSelect,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { useDebouncedValue, useDidUpdate } from "@mantine/hooks";
import { useNavigate } from "@remix-run/react";
import type {
	MediaLot,
	MediaSource,
} from "@ryot/generated/graphql/backend/graphql";
import { snakeCase } from "@ryot/ts-utils";
import {
	IconExternalLink,
	IconFilterOff,
	IconSearch,
	IconX,
} from "@tabler/icons-react";
import Cookies from "js-cookie";
import type { ReactNode } from "react";
import { useState } from "react";
import { getSurroundingElements } from "~/lib/generals";
import {
	useAppSearchParam,
	useCoreDetails,
	useFallbackImageUrl,
	useUserCollections,
} from "~/lib/hooks";
import classes from "~/styles/common.module.css";

export const ApplicationGrid = (props: {
	children: ReactNode | Array<ReactNode>;
}) => {
	return (
		<SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="lg">
			{props.children}
		</SimpleGrid>
	);
};

export const MediaDetailsLayout = (props: {
	children: Array<ReactNode | (ReactNode | undefined)>;
	images: Array<string | null | undefined>;
	externalLink?: {
		source: MediaSource;
		lot?: MediaLot;
		href?: string | null;
	};
}) => {
	const [activeImageId, setActiveImageId] = useState(0);
	const fallbackImageUrl = useFallbackImageUrl();

	return (
		<Flex direction={{ base: "column", md: "row" }} gap="lg">
			<Box
				id="images-container"
				pos="relative"
				className={classes.imagesContainer}
			>
				{props.images.length > 1 ? (
					<Carousel w={300} onSlideChange={setActiveImageId}>
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
							fallbackSrc={fallbackImageUrl}
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

export const MEDIA_DETAILS_HEIGHT = { base: "45vh", "2xl": "55vh" };

export const DebouncedSearchInput = (props: {
	initialValue?: string;
	queryParam?: string;
	placeholder?: string;
	enhancedQueryParams?: string;
}) => {
	const [query, setQuery] = useState(props.initialValue || "");
	const [debounced] = useDebouncedValue(query, 1000);
	const [_e, { setP }] = useAppSearchParam(
		props.enhancedQueryParams || "query",
	);

	useDidUpdate(() => {
		setP(props.queryParam || "query", debounced);
	}, [debounced]);

	return (
		<TextInput
			name="query"
			placeholder={props.placeholder || "Search..."}
			leftSection={<IconSearch />}
			onChange={(e) => setQuery(e.currentTarget.value)}
			value={query}
			style={{ flexGrow: 1 }}
			autoCapitalize="none"
			autoComplete="off"
			rightSection={
				query ? (
					<ActionIcon onClick={() => setQuery("")}>
						<IconX size={16} />
					</ActionIcon>
				) : null
			}
		/>
	);
};

export const ProRequiredAlert = (props: { tooltipLabel?: string }) => {
	const coreDetails = useCoreDetails();

	return !coreDetails.isPro ? (
		<Alert>
			<Tooltip label={props.tooltipLabel} disabled={!props.tooltipLabel}>
				<Text size="xs">
					<Anchor href={coreDetails.websiteUrl} target="_blank">
						Ryot Pro
					</Anchor>{" "}
					required to use this feature
				</Text>
			</Tooltip>
		</Alert>
	) : null;
};

export const FiltersModal = (props: {
	opened: boolean;
	cookieName: string;
	children: ReactNode;
	closeFiltersModal: () => void;
	title?: string;
}) => {
	const navigate = useNavigate();

	return (
		<Modal
			onClose={props.closeFiltersModal}
			opened={props.opened}
			withCloseButton={false}
			centered
		>
			<Stack>
				<Group justify="space-between">
					<Title order={3}>{props.title || "Filters"}</Title>
					<ActionIcon
						onClick={() => {
							navigate(".");
							props.closeFiltersModal();
							Cookies.remove(props.cookieName);
						}}
					>
						<IconFilterOff size={24} />
					</ActionIcon>
				</Group>
				{props.children}
			</Stack>
		</Modal>
	);
};

export const CollectionsFilter = (props: {
	cookieName: string;
	collections?: string[];
}) => {
	const collections = useUserCollections();
	const [_, { setP }] = useAppSearchParam(props.cookieName);

	return (
		<MultiSelect
			placeholder="Select a collection"
			defaultValue={props.collections}
			data={[
				{
					group: "My collections",
					items: collections.map((c) => ({
						value: c.id.toString(),
						label: c.name,
					})),
				},
			]}
			onChange={(v) => setP("collections", v.join(","))}
			clearable
			searchable
		/>
	);
};
