import {
	Box,
	Button,
	Card,
	Code,
	Container,
	Group,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import type { AppType } from "@ryot/app-backend";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { hc } from "hono/client";
import {
	Route as RouteIcon,
	Server,
	Shield,
	Sparkles,
	Waves,
	Zap,
} from "lucide-react";
import { useEffect } from "react";
import { useAuthClient } from "@/hooks/auth";

export const Route = createFileRoute("/")({ component: App });

const api = hc<AppType>("");

function App() {
	const authClient = useAuthClient();
	const { data } = useQuery({
		queryKey: ["hello"],
		queryFn: async () => {
			const res = await api.api.protected.$get();
			return res.text();
		},
	});

	useEffect(() => {
		authClient.signIn.anonymous();
	}, [authClient]);

	const features = [
		{
			icon: <Zap size={48} color="#22d3ee" />,
			title: "Powerful Server Functions",
			description:
				"Write server-side code that seamlessly integrates with your client components. Type-safe, secure, and simple.",
		},
		{
			icon: <Server size={48} color="#22d3ee" />,
			title: "Flexible Server Side Rendering",
			description:
				"Full-document SSR, streaming, and progressive enhancement out of the box. Control exactly what renders where.",
		},
		{
			icon: <RouteIcon size={48} color="#22d3ee" />,
			title: "API Routes",
			description:
				"Build type-safe API endpoints alongside your application. No separate backend needed.",
		},
		{
			icon: <Shield size={48} color="#22d3ee" />,
			title: "Strongly Typed Everything",
			description:
				"End-to-end type safety from server to client. Catch errors before they reach production.",
		},
		{
			icon: <Waves size={48} color="#22d3ee" />,
			title: "Full Streaming Support",
			description:
				"Stream data from server to client progressively. Perfect for AI applications and real-time updates.",
		},
		{
			icon: <Sparkles size={48} color="#22d3ee" />,
			title: "Next Generation Ready",
			description:
				"Built from the ground up for modern web applications. Deploy anywhere JavaScript runs.",
		},
	];

	return (
		<Box
			style={{
				minHeight: "100vh",
				background: "linear-gradient(to bottom, #0f172a, #1e293b, #0f172a)",
			}}
		>
			{JSON.stringify(data)}
			<Box
				style={{
					position: "relative",
					padding: "5rem 1.5rem",
					textAlign: "center",
					overflow: "hidden",
				}}
			>
				<Box
					style={{
						position: "absolute",
						inset: 0,
						background:
							"linear-gradient(to right, rgba(6,182,212,0.1), rgba(59,130,246,0.1), rgba(168,85,247,0.1))",
					}}
				/>
				<Container size="xl" style={{ position: "relative" }}>
					<Group justify="center" gap="xl" mb="xl">
						<img
							src="/tanstack-circle-logo.png"
							alt="TanStack Logo"
							style={{ width: 96, height: 96 }}
						/>
						<Title
							order={1}
							style={{
								fontSize: "4rem",
								fontWeight: 900,
								letterSpacing: "-0.08em",
								color: "white",
							}}
						>
							<Text component="span" c="gray.3">
								TANSTACK
							</Text>{" "}
							<Text
								component="span"
								style={{
									background: "linear-gradient(to right, #22d3ee, #60a5fa)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}
							>
								START
							</Text>
						</Title>
					</Group>
					<Text size="xl" c="gray.3" mb="sm" fw={300}>
						The framework for next generation AI applications
					</Text>
					<Text c="gray.5" maw={600} mx="auto" mb="xl">
						Full-stack framework powered by TanStack Router for React and Solid.
						Build modern applications with server functions, streaming, and type
						safety.
					</Text>
					<Stack align="center" gap="md">
						<Button
							component="a"
							href="https://tanstack.com/start"
							target="_blank"
							rel="noopener noreferrer"
							color="cyan"
							size="md"
						>
							Documentation
						</Button>
						<Text c="gray.5" size="sm" mt="xs">
							Begin your TanStack Start journey by editing{" "}
							<Code>/src/routes/index.tsx</Code>
						</Text>
					</Stack>
				</Container>
			</Box>

			<Container size="xl" py="xl">
				<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
					{features.map((feature, index) => (
						<Card
							withBorder
							key={index}
							radius="md"
							padding="lg"
							style={{
								backdropFilter: "blur(4px)",
								background: "rgba(30, 41, 59, 0.5)",
							}}
						>
							<Box mb="md">{feature.icon}</Box>
							<Title order={3} mb="xs" c="white">
								{feature.title}
							</Title>
							<Text c="gray.4">{feature.description}</Text>
						</Card>
					))}
				</SimpleGrid>
			</Container>
		</Box>
	);
}
