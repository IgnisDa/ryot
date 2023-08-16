import { Carousel } from "@mantine/carousel";
import { Anchor, Badge, Box, Flex, Image, Stack, Text } from "@mantine/core";
import { IconExternalLink } from "@tabler/icons-react";
import { useState } from "react";

function getSurroundingElements<T>(array: T[], element: number): number[] {
	if (array.length === 1) return [0];
	const lastIndex = array.length - 1;
	if (element === 0) return [lastIndex, element, element + 1];
	if (element === lastIndex) return [element - 1, element, 0];
	return [element - 1, element, element + 1];
}

export default function ({
	children,
	backdropImages,
	posterImages,
	externalLink,
}: {
	children: JSX.Element | (JSX.Element | null)[];
	posterImages: (string | null | undefined)[];
	backdropImages: string[];
	externalLink?: { source: string; href?: string | null };
}) {
	const images = [...posterImages, ...backdropImages];
	const [activeImageId, setActiveImageId] = useState<number>(0);

	return (
		<Flex direction={{ base: "column", md: "row" }} gap={"lg"}>
			<Box
				id="images-container"
				pos={"relative"}
				sx={(t) => ({
					width: "100%",
					flex: "none",
					[t.fn.largerThan("md")]: { width: "35%" },
				})}
			>
				{posterImages.length > 1 ? (
					<Carousel
						withIndicators={posterImages.length > 1}
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
								) : null}
							</Carousel.Slide>
						))}
					</Carousel>
				) : (
					<Box w={300}>
						<Image
							src={posterImages[0] || backdropImages[0]}
							withPlaceholder
							height={400}
							radius={"lg"}
						/>
					</Box>
				)}
				{externalLink ? (
					<Badge
						id="data-source"
						pos={"absolute"}
						size="lg"
						top={10}
						left={10}
						color="dark"
						variant="filled"
					>
						<Flex gap={4}>
							<Text>{externalLink.source}</Text>
							{externalLink.href ? (
								<Anchor href={externalLink.href} target="_blank">
									<IconExternalLink size="1rem" />
								</Anchor>
							) : null}
						</Flex>
					</Badge>
				) : undefined}
			</Box>
			<Stack id="details-container" style={{ flexGrow: 1 }}>
				{children}
			</Stack>
		</Flex>
	);
}
