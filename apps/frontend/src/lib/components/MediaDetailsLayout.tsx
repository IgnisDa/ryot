import { Carousel } from "@mantine/carousel";
import { Anchor, Badge, Box, Flex, Image, Stack, Text } from "@mantine/core";
import { IconExternalLink } from "@tabler/icons-react";

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
				{posterImages.length > 0 ? (
					<Carousel withIndicators={posterImages.length > 1} w={300}>
						{[...posterImages, ...backdropImages].map((url, idx) => (
							<Carousel.Slide key={url} data-image-idx={idx}>
								<Image src={url} radius={"lg"} />
							</Carousel.Slide>
						))}
					</Carousel>
				) : (
					<Box w={300}>
						<Image withPlaceholder height={400} radius={"lg"} />
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
