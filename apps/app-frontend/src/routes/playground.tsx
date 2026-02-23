import {
	Box,
	Button,
	Card,
	Container,
	Group,
	SimpleGrid,
	Stack,
	Text,
	Textarea,
	Title,
} from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useApiClient } from "@/hooks/api";
import { useAuthClient } from "@/hooks/auth";

export const Route = createFileRoute("/playground")({ component: App });

const defaultCode = `console.log("calling addNumbers in host API...");

const mathResult = await addNumbers(21, 21);

if (mathResult.success !== true) {
  console.log("addNumbers failed:", mathResult.error);
  return mathResult;
}

console.log("sum from db:", mathResult.data);

const apiResult = await httpCall("GET", "https://httpbin.org/get", {
  headers: { Accept: "application/json" },
});

if (apiResult.success !== true) {
  console.log("httpCall failed:", apiResult.error);
  return {
    mathResult,
    apiResult,
  };
}

console.log("http status:", apiResult.data.status);

return {
  mathResult,
  apiResult: {
    status: apiResult.data.status,
    statusText: apiResult.data.statusText,
  },
};`;

type SandboxRunResponse = {
	durationMs: number;
	success: boolean;
	value?: unknown;
	error?: string;
	logs?: string;
};

const parseErrorMessage = (payload: unknown) => {
	if (!payload || typeof payload !== "object") {
		return "Failed to run code";
	}

	if (!("error" in payload)) {
		return "Failed to run code";
	}

	return typeof payload.error === "string"
		? payload.error
		: "Failed to run code";
};

const parseSandboxResponse = (payload: unknown): SandboxRunResponse => {
	if (!payload || typeof payload !== "object") {
		return { success: false, durationMs: 0, error: "Invalid response" };
	}

	const body = payload as Record<string, unknown>;

	const durationMs = typeof body.durationMs === "number" ? body.durationMs : 0;
	const success = body.success === true;
	const logs = typeof body.logs === "string" ? body.logs : undefined;
	const error = typeof body.error === "string" ? body.error : undefined;

	return {
		success,
		logs,
		error,
		durationMs,
		value: body.value,
	};
};

function App() {
	const apiClient = useApiClient();
	const authClient = useAuthClient();
	const [code, setCode] = useState(defaultCode);

	useEffect(() => {
		void authClient.signIn.anonymous();
	}, [authClient]);

	const runMutation = useMutation({
		mutationFn: async (scriptCode: string) => {
			const response = await apiClient.protected.sandbox.run.$post({
				json: { code: scriptCode },
			});
			const payload = await response.json();

			if (!response.ok) {
				throw new Error(parseErrorMessage(payload));
			}

			return parseSandboxResponse(payload);
		},
	});

	const valueText = runMutation.data
		? JSON.stringify(runMutation.data.value ?? null, null, 2)
		: "No value yet.";
	const logsText = runMutation.data?.logs?.trim()
		? runMutation.data.logs
		: "No logs yet.";

	return (
		<Box
			style={{
				minHeight: "100vh",
				background: "linear-gradient(180deg, #f5f6f8 0%, #eceff4 100%)",
			}}
		>
			<Container size="lg" py="xl">
				<Stack gap="lg">
					<Stack gap={4}>
						<Group justify="space-between" align="center">
							<Title order={2}>Sandbox Playground</Title>
							<Button component={Link} to="/schema-search" variant="light">
								Open schema search
							</Button>
						</Group>
						<Text c="dimmed">
							Write JavaScript for an async function body. Use `return` for
							value and `console.log` for logs. Host helpers: `addNumbers(a, b)`
							and `httpCall(method, url, options)`.
						</Text>
					</Stack>

					<Textarea
						autosize
						minRows={16}
						value={code}
						onChange={(event) => setCode(event.currentTarget.value)}
						styles={{ input: { fontFamily: "ui-monospace, monospace" } }}
					/>

					<Group justify="space-between">
						<Text c="dimmed" size="sm">
							{runMutation.isPending
								? "Running..."
								: runMutation.data
									? `Completed in ${runMutation.data.durationMs}ms`
									: "Ready"}
						</Text>
						<Button
							loading={runMutation.isPending}
							onClick={() => runMutation.mutate(code)}
							disabled={!code.trim() || runMutation.isPending}
						>
							Run code
						</Button>
					</Group>

					{runMutation.error ? (
						<Text c="red" size="sm">
							{runMutation.error.message}
						</Text>
					) : null}

					{runMutation.data?.error ? (
						<Text c="orange" size="sm">
							Sandbox error: {runMutation.data.error}
						</Text>
					) : null}

					<SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
						<Card withBorder radius="md" padding="md">
							<Stack gap="sm">
								<Title order={4}>value</Title>
								<Box
									component="pre"
									style={{
										margin: 0,
										fontSize: "0.85rem",
										maxHeight: 320,
										overflow: "auto",
										padding: "0.75rem",
										borderRadius: "0.5rem",
										whiteSpace: "pre-wrap",
										background: "#0f172a",
										fontFamily: "ui-monospace, monospace",
										color: "#e2e8f0",
									}}
								>
									{valueText}
								</Box>
							</Stack>
						</Card>

						<Card withBorder radius="md" padding="md">
							<Stack gap="sm">
								<Title order={4}>logs</Title>
								<Box
									component="pre"
									style={{
										margin: 0,
										fontSize: "0.85rem",
										maxHeight: 320,
										overflow: "auto",
										padding: "0.75rem",
										borderRadius: "0.5rem",
										whiteSpace: "pre-wrap",
										background: "#111827",
										fontFamily: "ui-monospace, monospace",
										color: "#d1d5db",
									}}
								>
									{logsText}
								</Box>
							</Stack>
						</Card>
					</SimpleGrid>
				</Stack>
			</Container>
		</Box>
	);
}
