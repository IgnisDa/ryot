import type { paths } from "@ryot/generated/openapi/app-backend";

import { requirePresent, requireResponseData } from "../test-support/assertions";
import type { Client } from "./auth";
import { type PollOptions, pollUntil } from "./polling";

type CreateSandboxScriptBody = NonNullable<
	paths["/sandbox/scripts"]["post"]["requestBody"]
>["content"]["application/json"];

type EnqueueSandboxBody = NonNullable<
	paths["/sandbox/enqueue"]["post"]["requestBody"]
>["content"]["application/json"];

export async function createSandboxScript(
	client: Client,
	cookies: string,
	body: CreateSandboxScriptBody,
) {
	const { data, response } = await client.POST("/sandbox/scripts", {
		body,
		headers: { Cookie: cookies },
	});

	const script = requireResponseData(response, data, "Failed to create sandbox script");
	requirePresent(script.id, "Failed to create sandbox script");
	return script;
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

	return {
		jobId: requirePresent(
			requireResponseData(response, data, "Failed to enqueue sandbox script").jobId,
			"Failed to enqueue sandbox script",
		),
	};
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
			const result = requireResponseData(
				response,
				data,
				`Failed to poll sandbox result '${jobId}'`,
			);
			return result.status !== "pending" ? result : null;
		},
		options,
	);
}
