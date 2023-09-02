import { Carousel } from "@mantine/carousel";
import { Anchor, Badge, Box, Flex, Image, Stack, Text } from "@mantine/core";
import type {
	MetadataLot,
	MetadataSource,
} from "@ryot/generated/graphql/backend/graphql";
import { snakeCase } from "@ryot/ts-utils";
import { IconExternalLink } from "@tabler/icons-react";
import { useState } from "react";

function getSurroundingElements<T>(array: T[], element: number): number[] {
	if (array.length === 1) return [0];
	const lastIndex = array.length - 1;
	if (element === 0) return [lastIndex, element, element + 1];
	if (element === lastIndex) return [element - 1, element, 0];
	return [element - 1, element, element + 1];
}

export default function (props: {
	children: JSX.Element | (JSX.Element | undefined)[];
	posterImages: (string | null | undefined)[];
	backdropImages: string[];
	externalLink?: {
		lot: MetadataLot;
		source: MetadataSource;
		href?: string | null;
	};
}) {
	const images = [...props.posterImages, ...props.backdropImages];
	const [activeImageId, setActiveImageId] = useState<number>(0);

	return (
		<Flex direction={{ base: "column", md: "row" }} gap="lg">
			<Box
				id="images-container"
				pos="relative"
				sx={(t) => ({
					width: "100%",
					flex: "none",
					[t.fn.largerThan("md")]: { width: "35%" },
				})}
			>
				{props.posterImages.length > 1 ? (
					<Carousel
						withIndicators={props.posterImages.length > 1}
						w={300}
						onSlideChange={setActiveImageId}
					>
						{images.map((url, idx) => (
							<Carousel.Slide key={url} data-image-idx={idx}>
								{getSurroundingElements(images, activeImageId).includes(idx) ? (
									<Image
										src={url}
										radius="lg"
										imageProps={{ loading: "lazy" }}
									/>
								) : undefined}
							</Carousel.Slide>
						))}
					</Carousel>
				) : (
					<Box w={300}>
						<Image
							src={props.posterImages[0] || props.backdropImages[0]}
							withPlaceholder
							height={400}
							radius="lg"
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
						<Flex gap={4} align={"center"}>
							<Text size={10}>
								{snakeCase(props.externalLink.source)}:
								{snakeCase(props.externalLink.lot)}
							</Text>
							{props.externalLink.href ? (
								<Anchor href={props.externalLink.href} target="_blank" mt={2}>
									<IconExternalLink size="0.8rem" />
								</Anchor>
							) : undefined}
						</Flex>
					</Badge>
				) : undefined}
			</Box>
			<Stack id="details-container" style={{ flexGrow: 1 }}>
				{props.children}
			</Stack>
		</Flex>
	);
}
