import { Image, Text, Flex } from "@mantine/core";
import type { BooksSearchQuery } from "@trackona/generated/graphql/backend/graphql";

export default function SearchMedia(props: {
	item: BooksSearchQuery["booksSearch"]["items"][number];
	idx: number;
	onClick: () => Promise<void>;
}) {
	return (
		<Flex
			key={props.item.identifier}
			align={"center"}
			justify={"center"}
			direction={"column"}
		>
			<Image
				src={props.item.images.at(0)}
				radius={"md"}
				height={250}
				withPlaceholder
				placeholder={<Text size={60}>?</Text>}
				style={{ cursor: "pointer" }}
				alt={`Image for ${props.item.title}`}
				onClick={props.onClick}
			/>
			<Flex justify={"space-between"} w="100%">
				<Text c="dimmed">{props.item.publishYear}</Text>
				<Text c="dimmed">Book</Text>
			</Flex>
			<Text w="100%" truncate fw={"bold"}>
				{props.item.title}
			</Text>
		</Flex>
	);
}
