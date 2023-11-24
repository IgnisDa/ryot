import { SimpleGrid } from "@mantine/core";

export function Grid(props: {
	children: JSX.Element[];
}) {
	return (
		<SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="lg">
			{props.children}
		</SimpleGrid>
	);
}
