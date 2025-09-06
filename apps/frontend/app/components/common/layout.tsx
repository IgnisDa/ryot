import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Carousel } from "@mantine/carousel";
import {
	ActionIcon,
	Box,
	Flex,
	Group,
	Image,
	Loader,
	Modal,
	Paper,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	type EntityAssets,
	type EntityLot,
	GridPacking,
	type MediaLot,
	type MediaSource,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import { IconExternalLink } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { match } from "ts-pattern";
import {
	useFallbackImageUrl,
	usePartialStatusMonitor,
	useUserPreferences,
} from "~/lib/shared/hooks";
import {
	getProviderSourceImage,
	getSurroundingElements,
} from "~/lib/shared/ui-utils";
import { useFullscreenImage } from "~/lib/state/general";
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
	externalLink: {
		lot?: MediaLot;
		source: MediaSource;
		href?: string | null;
	};
	partialDetailsFetcher: {
		entityId: string;
		fn: () => unknown;
		entityLot: EntityLot;
		partialStatus?: boolean | null;
	};
}) => {
	const [activeImageId, setActiveImageId] = useState(0);
	const fallbackImageUrl = useFallbackImageUrl();

	const { isPartialStatusActive } = usePartialStatusMonitor({
		onUpdate: props.partialDetailsFetcher.fn,
		externalLinkSource: props.externalLink.source,
		entityId: props.partialDetailsFetcher.entityId,
		partialStatus: props.partialDetailsFetcher.partialStatus,
	});

	const images = [...props.assets.remoteImages, ...props.assets.s3Images];

	const providerImage = getProviderSourceImage(props.externalLink.source);

	return (
		<Flex direction={{ base: "column", md: "row" }} gap="lg">
			<Box
				pos="relative"
				id="images-container"
				className={classes.imagesContainer}
			>
				<Paper
					px={10}
					top={0}
					left={0}
					right={0}
					pos="absolute"
					py={providerImage ? 4 : 10}
					style={{
						zIndex: 1,
						display: "flex",
						alignItems: "center",
						borderTopLeftRadius: "1rem",
						borderTopRightRadius: "1rem",
						justifyContent: "space-between",
						backgroundColor: "rgba(0, 0, 0, 0.75)",
					}}
				>
					<Text size="sm" fw="bold" c="blue">
						{changeCase(props.externalLink.lot || props.externalLink.source)}
					</Text>
					<Group wrap="nowrap">
						{providerImage ? (
							<Image
								h={20}
								alt="Logo"
								fit="contain"
								src={`/provider-logos/${providerImage}`}
							/>
						) : null}
						{props.externalLink.href ? (
							<ActionIcon
								onClick={() => {
									if (props.externalLink.href)
										window.open(
											props.externalLink.href,
											"_blank",
											"noopener,noreferrer",
										);
								}}
							>
								<IconExternalLink size={18} />
							</ActionIcon>
						) : null}
					</Group>
				</Paper>
				{images.length > 1 ? (
					<Carousel w="100%" onSlideChange={setActiveImageId}>
						{images.map((url, idx) => (
							<Carousel.Slide key={url} data-image-idx={idx}>
								{getSurroundingElements(images, activeImageId).includes(idx) ? (
									<Image src={url} radius="lg" />
								) : null}
							</Carousel.Slide>
						))}
					</Carousel>
				) : (
					<Box w="100%">
						<Image
							radius="lg"
							height={400}
							src={images[0]}
							fallbackSrc={fallbackImageUrl}
						/>
					</Box>
				)}
			</Box>
			<Stack id="details-container" style={{ flexGrow: 1 }}>
				<Group wrap="nowrap">
					{isPartialStatusActive ? <Loader size="sm" /> : null}
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
