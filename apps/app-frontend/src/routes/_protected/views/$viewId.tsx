import { Container, Stack, Title } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/views/$viewId")({
	component: RouteComponent,
});

function RouteComponent() {
	const params = Route.useParams();

	return (
		<Container size="xl" py="xl">
			<Stack gap="xl">
				<Title order={2}>View: {params.viewId}</Title>
			</Stack>
		</Container>
	);
}
