import type { paths } from "@ryot/generated/openapi/app-backend";
import type { Client } from "./auth";
import { type PollOptions, pollUntil } from "./polling";

type CreateSandboxScriptBody = NonNullable<
	paths["/sandbox/scripts"]["post"]["requestBody"]
>["content"]["application/json"];

type EnqueueSandboxBody = NonNullable<
	paths["/sandbox/enqueue"]["post"]["requestBody"]
>["content"]["application/json"];

type PollSandboxResponse =
	paths["/sandbox/result/{jobId}"]["get"]["responses"][200]["content"]["application/json"]["data"];

export async function createSandboxScript(
	client: Client,
	cookies: string,
	body: CreateSandboxScriptBody,
) {
	const { data, response } = await client.POST("/sandbox/scripts", {
		body,
		headers: { Cookie: cookies },
	});

	if (response.status !== 200 || !data?.data?.id) {
		throw new Error("Failed to create sandbox script");
	}

	return data.data;
}

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
	options: PollOptions = {},
) {
	return pollUntil(
		`sandbox job '${jobId}'`,
		async () => {
			const { data, response } = await client.GET("/sandbox/result/{jobId}", {
				params: { path: { jobId } },
				headers: { Cookie: cookies },
			});
			if (response.status !== 200 || !data?.data) {
				throw new Error(`Failed to poll sandbox result '${jobId}'`);
			}
			const result: PollSandboxResponse = data.data;
			return result.status !== "pending" ? result : null;
		},
		options,
	);
}
