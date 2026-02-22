import { Box, Button, Container } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuthClient } from "@/hooks/auth";

export const Route = createFileRoute("/")({ component: App });

function App() {
	const authClient = useAuthClient();

	useEffect(() => {
		void authClient.signIn.anonymous();
	}, [authClient]);

	const runMutation = useMutation({
		mutationFn: async () => {
			const response = await authClient.apiKey.create();
			return response.data;
		},
	});

	return (
		<Box
			style={{
				minHeight: "100vh",
				background: "linear-gradient(180deg, #f5f6f8 0%, #eceff4 100%)",
			}}
		>
			<Container size="lg" py="xl">
				<Box>
					API Key: {runMutation.data?.key || "No API Key generated yet."}
				</Box>
				<Button onClick={() => runMutation.mutate()} mt="md">
					Generate API Key
				</Button>
			</Container>
		</Box>
	);
}
