import type { paths } from "@ryot/generated/openapi/app-backend";
import { dayjs } from "@ryot/ts-utils/dayjs";
import type { Client } from "./auth";

type EnqueueSandboxBody = NonNullable<
	paths["/sandbox/enqueue"]["post"]["requestBody"]
>["content"]["application/json"];

type PollSandboxResponse =
	paths["/sandbox/result/{jobId}"]["get"]["responses"][200]["content"]["application/json"]["data"];

export interface PollSandboxResultOptions {
	timeoutMs?: number;
	intervalMs?: number;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function enqueueSandboxScript(
	client: Client,
	cookies: string,
	body: EnqueueSandboxBody,
) {
	const { data, response } = await client.POST("/sandbox/enqueue", {
		body,
		headers: { Cookie: cookies },
	});

	if (response.status !== 200 || !data?.data?.jobId) {
		throw new Error("Failed to enqueue sandbox script");
	}

	return { jobId: data.data.jobId };
}

export async function pollSandboxResult(
	client: Client,
	cookies: string,
	jobId: string,
	options: PollSandboxResultOptions = {},
) {
	const { intervalMs = 500, timeoutMs = 30_000 } = options;
	const deadline = dayjs().add(timeoutMs, "millisecond");

	for (;;) {
		const { data, response } = await client.GET("/sandbox/result/{jobId}", {
			params: { path: { jobId } },
			headers: { Cookie: cookies },
		});

		if (response.status !== 200 || !data?.data) {
			throw new Error(`Failed to poll sandbox result '${jobId}'`);
		}

		const result: PollSandboxResponse = data.data;
		if (result.status !== "pending") {
			return result;
		}

		const remainingMs = deadline.diff(dayjs());
		if (remainingMs <= 0) {
			break;
		}

		await delay(Math.min(intervalMs, remainingMs));
	}

	throw new Error(
		`Sandbox result '${jobId}' did not reach a terminal state within ${timeoutMs}ms`,
	);
}
