import { Image, Text, Flex, Button, Space } from "@mantine/core";
import {
	SeenStatus,
	type BooksSearchQuery,
} from "@trackona/generated/graphql/backend/graphql";
import { match } from "ts-pattern";
import { getInitials } from "../utilities";

export default function SearchMedia(props: {
	item: BooksSearchQuery["booksSearch"]["items"][number];
	idx: number;
	onClick: () => Promise<void>;
}) {
	const seenElm = match(props.item.status)
		.with(SeenStatus.NotConsumed, SeenStatus.NotInDatabase, () => (
			<Button variant="outline" w="100%" compact>
				Mark as read
			</Button>
		))
		.with(SeenStatus.Undetermined, SeenStatus.ConsumedAtleastOnce, () => <></>)
		.exhaustive();

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
				placeholder={<Text size={60}>{getInitials(props.item.title)}</Text>}
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
			<Space h="xs" />
			{seenElm}
		</Flex>
	);
}
