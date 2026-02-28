import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button, Container, View } from "reshaped";
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
		<div
			style={{
				minHeight: "100vh",
				background: "linear-gradient(180deg, #f5f6f8 0%, #eceff4 100%)",
			}}
		>
			<Container width="964px" padding={8}>
				<View gap={4}>
					<View>
						API Key: {runMutation.data?.key || "No API Key generated yet."}
					</View>
					<Button onClick={() => runMutation.mutate()}>Generate API Key</Button>
				</View>
			</Container>
		</div>
	);
}
