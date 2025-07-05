import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Carousel } from "@mantine/carousel";
import {
	ActionIcon,
	Anchor,
	Badge,
	Box,
	Flex,
	Group,
	Image,
	Loader,
	Modal,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	type EntityAssets,
	GridPacking,
	type MediaLot,
	type MediaSource,
} from "@ryot/generated/graphql/backend/graphql";
import { snakeCase } from "@ryot/ts-utils";
import { IconExternalLink, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useRevalidator } from "react-router";
import { match } from "ts-pattern";
import { useFallbackImageUrl, useUserPreferences } from "~/lib/hooks";
import { refreshEntityDetails } from "~/lib/query-factory";
import { useFullscreenImage } from "~/lib/state/general";
import { getSurroundingElements } from "~/lib/ui-utils";
import classes from "~/styles/common.module.css";

export const ApplicationGrid = (props: {
	className?: string;
	children: ReactNode | Array<ReactNode>;
}) => {
	const userPreferences = useUserPreferences();
	const [parent] = useAutoAnimate();

	return (
		<SimpleGrid
			spacing="lg"
			ref={parent}
			className={props.className}
			cols={match(userPreferences.general.gridPacking)
				.with(GridPacking.Normal, () => ({ base: 2, sm: 3, md: 4, lg: 5 }))
				.with(GridPacking.Dense, () => ({ base: 3, sm: 4, md: 5, lg: 6 }))
				.exhaustive()}
		>
			{props.children}
		</SimpleGrid>
	);
};

export const MediaDetailsLayout = (props: {
	title: string;
	assets: EntityAssets;
	children: Array<ReactNode | (ReactNode | undefined)>;
	externalLink?: {
		lot?: MediaLot;
		source: MediaSource;
		href?: string | null;
	};
	partialDetailsFetcher: {
		entityId: string;
		isAlreadyPartial?: boolean | null;
		fn: () => Promise<boolean | undefined | null>;
	};
}) => {
	const [activeImageId, setActiveImageId] = useState(0);
	const fallbackImageUrl = useFallbackImageUrl();
	const revalidator = useRevalidator();

	const { data: isPartialData } = useQuery({
		queryFn: props.partialDetailsFetcher.fn,
		enabled: Boolean(props.partialDetailsFetcher.isAlreadyPartial),
		queryKey: ["pollDetails", props.partialDetailsFetcher.entityId],
		refetchInterval: (query) => {
			if (query.state.data === true) return 500;
			return false;
		},
	});

	const images = [...props.assets.remoteImages, ...props.assets.s3Images];

	return (
		<Flex direction={{ base: "column", md: "row" }} gap="lg">
			<Box
				pos="relative"
				id="images-container"
				className={classes.imagesContainer}
			>
				{images.length > 1 ? (
					<Carousel w={300} onSlideChange={setActiveImageId}>
						{images.map((url, idx) => (
							<Carousel.Slide key={url} data-image-idx={idx}>
								{getSurroundingElements(images, activeImageId).includes(idx) ? (
									<Image src={url} radius="lg" />
								) : null}
							</Carousel.Slide>
						))}
					</Carousel>
				) : (
					<Box w={300}>
						<Image
							radius="lg"
							height={400}
							src={images[0]}
							fallbackSrc={fallbackImageUrl}
						/>
					</Box>
				)}
				{props.externalLink ? (
					<Badge
						size="lg"
						top={10}
						left={10}
						color="dark"
						pos="absolute"
						id="data-source"
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
				<Group wrap="nowrap">
					{props.partialDetailsFetcher.isAlreadyPartial ? (
						isPartialData ? (
							<Loader size="sm" />
						) : (
							<ActionIcon
								size="sm"
								onClick={() => {
									refreshEntityDetails(props.partialDetailsFetcher.entityId);
									revalidator.revalidate();
								}}
							>
								<IconRefresh />
							</ActionIcon>
						)
					) : null}
					<Title id="media-title">{props.title}</Title>
				</Group>
				{props.children}
			</Stack>
		</Flex>
	);
};

export const FullscreenImageModal = () => {
	const { fullscreenImage, setFullscreenImage } = useFullscreenImage();

	return (
		<Modal
			fullScreen
			zIndex={1000}
			opened={!!fullscreenImage}
			onClose={() => setFullscreenImage(null)}
		>
			{fullscreenImage && (
				<Image
					alt="Fullscreen image"
					src={fullscreenImage.src}
					style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain" }}
				/>
			)}
		</Modal>
	);
};
