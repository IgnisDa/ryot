import { SimpleGrid } from "@mantine/core";

export default function (props: {
	children: JSX.Element[];
	listType: "grid" | "poster";
}) {
	return (
		<SimpleGrid
			cols={props.listType === "grid" ? 1 : 2}
			spacing="lg"
			breakpoints={
				props.listType === "grid"
					? [
							{ minWidth: "md", cols: 2 },
							{ minWidth: "lg", cols: 3 },
					  ]
					: [
							{ minWidth: "sm", cols: 3 },
							{ minWidth: "md", cols: 4 },
							{ minWidth: "lg", cols: 5 },
					  ]
			}
		>
			{props.children}
		</SimpleGrid>
	);
}
