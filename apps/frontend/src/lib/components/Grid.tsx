import { SimpleGrid } from "@mantine/core";

export default function (props: { children: JSX.Element[] }) {
	return (
		<SimpleGrid
			cols={2}
			spacing="lg"
			breakpoints={[
				{ minWidth: "sm", cols: 3 },
				{ minWidth: "md", cols: 4 },
				{ minWidth: "lg", cols: 5 },
				{ minWidth: "3xl", cols: 6 },
			]}
		>
			{props.children}
		</SimpleGrid>
	);
}
