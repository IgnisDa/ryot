import { Carousel } from "@mantine/carousel";
import "@mantine/carousel/styles.css";
import {
	ActionIcon,
	Anchor,
	Badge,
	Box,
	Flex,
	Image,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	useComputedColorScheme,
} from "@mantine/core";
import { useDebouncedState, useDidUpdate } from "@mantine/hooks";
import type {
	MediaLot,
	MediaSource,
} from "@ryot/generated/graphql/backend/graphql";
import { snakeCase } from "@ryot/ts-utils";
import { IconExternalLink, IconSearch, IconX } from "@tabler/icons-react";
import { type ReactNode, useRef } from "react";
import { useState } from "react";
import { withFragment, withoutHost } from "ufo";
import { getFallbackImageUrl, redirectToQueryParam } from "~/lib/generals";
import { useSearchParam } from "~/lib/hooks";
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

function getSurroundingElements<T>(
	array: Array<T>,
	element: number,
): Array<number> {
	if (array.length === 1) return [0];
	const lastIndex = array.length - 1;
	if (element === 0) return [lastIndex, element, element + 1];
	if (element === lastIndex) return [element - 1, element, 0];
	return [element - 1, element, element + 1];
}

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

export const MEDIA_DETAILS_HEIGHT = { base: "45vh", "2xl": "55vh" };

export const HiddenLocationInput = (props: { hash?: string }) => {
	const value = withoutHost(
		typeof window !== "undefined" ? window.location.href : "",
	);

	return (
		<input
			type="hidden"
			name={redirectToQueryParam}
			value={withFragment(value, props.hash || "")}
			readOnly
		/>
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
