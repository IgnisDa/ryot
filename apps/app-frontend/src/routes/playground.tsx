import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Card, Container, Grid, Text, TextArea, View } from "reshaped";
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
	const navigate = Route.useNavigate();
	const [code, setCode] = useState(defaultCode);

	useEffect(() => {
		void authClient.signIn.anonymous();
	}, [authClient]);

	const runMutation = useMutation({
		mutationFn: async (scriptCode: string) => {
			const response = await apiClient.sandbox.run.$post({
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
		<div
			style={{
				minHeight: "100vh",
				background: "linear-gradient(180deg, #f5f6f8 0%, #eceff4 100%)",
			}}
		>
			<Container width="964px" padding={8}>
				<View gap={6}>
					<View gap={1}>
						<View direction="row" justify="space-between" align="center">
							<Text variant="title-2" as="h2">
								Sandbox Playground
							</Text>
							<Button
								onClick={() => navigate({ to: "/schema-search" })}
								variant="faded"
							>
								Open schema search
							</Button>
						</View>
						<Text color="neutral-faded">
							Write JavaScript for an async function body. Use `return` for
							value and `console.log` for logs. Host helpers: `addNumbers(a, b)`
							and `httpCall(method, url, options)`.
						</Text>
					</View>

					<TextArea
						name="code"
						resize="auto"
						value={code}
						onChange={(event) => setCode(event.value)}
						inputAttributes={{
							rows: 16,
							style: { fontFamily: "ui-monospace, monospace" },
						}}
					/>

					<View direction="row" justify="space-between">
						<Text color="neutral-faded" variant="caption-1">
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
					</View>

					{runMutation.error ? (
						<Text color="critical" variant="caption-1">
							{runMutation.error.message}
						</Text>
					) : null}

					{runMutation.data?.error ? (
						<Text color="warning" variant="caption-1">
							Sandbox error: {runMutation.data.error}
						</Text>
					) : null}

					<Grid columns={{ s: 1, m: 2 }}>
						<Grid.Item>
							<Card padding={4}>
								<View gap={3}>
									<Text variant="title-4" as="h4">
										value
									</Text>
									<pre
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
									</pre>
								</View>
							</Card>
						</Grid.Item>

						<Grid.Item>
							<Card padding={4}>
								<View gap={3}>
									<Text variant="title-4" as="h4">
										logs
									</Text>
									<pre
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
									</pre>
								</View>
							</Card>
						</Grid.Item>
					</Grid>
				</View>
			</Container>
		</div>
	);
}
