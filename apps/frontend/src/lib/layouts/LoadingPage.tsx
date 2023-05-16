import { Container, Grid, Skeleton } from "@mantine/core";

const loaderChild = <Skeleton height={140} radius="md" />;

export default function () {
	return (
		<Container>
			<Grid>
				<Grid.Col xs={4}>{loaderChild}</Grid.Col>
				<Grid.Col xs={8}>{loaderChild}</Grid.Col>
				<Grid.Col xs={8}>{loaderChild}</Grid.Col>
				<Grid.Col xs={4}>{loaderChild}</Grid.Col>
			</Grid>
		</Container>
	);
}
