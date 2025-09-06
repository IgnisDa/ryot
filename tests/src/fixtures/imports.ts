import { getBackendUrl } from "../setup";
import { requirePresent, requireResponseData } from "../test-support/assertions";
import type { Client } from "./auth";
import { pollUntil } from "./polling";

const OPENSCALE_SAMPLE_CSV = `dateTime,weight,bmi,fat,water,muscle,comment
2026-04-01 08:00:00,75.0,22.5,15.0,60.0,40.0,Morning weight
2026-04-02 08:00:00,74.8,22.4,14.9,60.2,40.1,
2026-04-03 08:00:00,75.2,22.6,15.1,60.0,40.0,After lunch
`;

export async function uploadTemporaryFile(
	cookies: string,
	content: string,
	fileName: string,
	mimeType: string,
): Promise<string> {
	const formData = new FormData();
	formData.append("files[]", new File([content], fileName, { type: mimeType }));

	const response = await fetch(`${getBackendUrl()}/uploads/temporary`, {
		body: formData,
		method: "POST",
		headers: { Cookie: cookies },
	});

	const json: { data?: string[] } = await response.json();
	const tokens = requireResponseData(response, json, "Failed to upload temporary file");
	return requirePresent(tokens[0], "Upload token is missing");
}

export async function startOpenScaleImport(
	client: Client,
	cookies: string,
	uploadToken: string,
): Promise<string> {
	const { data, response } = await client.POST("/imports/runs", {
		headers: { Cookie: cookies },
		body: { source: "open_scale", uploadToken },
	});

	const result = requireResponseData(response, data, "Failed to start import run");
	return requirePresent(result.id, "Import run id is missing");
}

export async function getImportRun(client: Client, cookies: string, runId: string) {
	const { data, response } = await client.GET("/imports/runs/{runId}", {
		params: { path: { runId } },
		headers: { Cookie: cookies },
	});

	return requireResponseData(response, data, `Failed to get import run '${runId}'`);
}

export async function pollImportRunUntilTerminal(client: Client, cookies: string, runId: string) {
	return pollUntil(
		`Import run '${runId}' to complete`,
		async () => {
			const run = await getImportRun(client, cookies, runId);
			if (run.status === "completed" || run.status === "failed") {
				return run;
			}
			return null;
		},
		{ timeoutMs: 60_000, intervalMs: 500 },
	);
}

export async function runOpenScaleImportFixture(client: Client, cookies: string) {
	const uploadToken = await uploadTemporaryFile(
		cookies,
		OPENSCALE_SAMPLE_CSV,
		"openscale-export.csv",
		"text/csv",
	);

	const runId = await startOpenScaleImport(client, cookies, uploadToken);
	const completedRun = await pollImportRunUntilTerminal(client, cookies, runId);
	return { runId, completedRun };
}
