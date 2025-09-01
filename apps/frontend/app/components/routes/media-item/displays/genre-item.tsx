import { Anchor, Box, Group } from "@mantine/core";
import type { GenreListItem } from "@ryot/generated/graphql/backend/graphql";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { useGetRandomMantineColor } from "~/lib/shared/hooks";

export function GenreItem(props: {
	genre: GenreListItem;
}) {
	const color = useGetRandomMantineColor(props.genre.name);

	return (
		<Group wrap="nowrap">
			<Box h={11} w={11} bg={color} style={{ borderRadius: 2, flex: "none" }} />
			<Anchor
				fz="sm"
				truncate
				component={Link}
				to={$path("/media/genre/:id", { id: props.genre.id })}
			>
				{props.genre.name.trim()}
			</Anchor>
		</Group>
	);
}
