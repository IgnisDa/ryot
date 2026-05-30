import { getBackendUrl } from "../setup";
import { requirePresent } from "../test-support/assertions";
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
	formData.append("files[]", new File([content], fileName, { type: mimeType }), fileName);

	const response = await fetch(`${getBackendUrl()}/uploads/temporary`, {
		body: formData,
		method: "POST",
		headers: { Cookie: cookies },
	});

	const tokens: string[] = await response.json();
	return requirePresent(tokens[0], "Upload token is missing");
}

export async function startOpenScaleImport(client: Client, uploadToken: string): Promise<string> {
	const result = await client.run((c) =>
		c.imports.createRun({ payload: { source: "open_scale", uploadToken } }),
	);

	return requirePresent(result.id, "Import run id is missing");
}

export async function getImportRun(client: Client, runId: string) {
	return client.run((c) => c.imports.getRun({ path: { runId }, urlParams: {} }));
}

export async function pollImportRunUntilTerminal(client: Client, runId: string) {
	return pollUntil(
		`Import run '${runId}' to complete`,
		async () => {
			const run = await getImportRun(client, runId);
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

	const runId = await startOpenScaleImport(client, uploadToken);
	const completedRun = await pollImportRunUntilTerminal(client, runId);
	return { runId, completedRun };
}

const HEVY_SAMPLE_CSV = `title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_order,weight_kg,reps,set_type,distance_m,duration_seconds
Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Good session,Bench Press,,Felt strong,1,100,5,normal,,
Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Good session,Bench Press,,,2,100,5,normal,,
Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Good session,Squat,,,1,140,3,normal,,
`;

export async function runHevyImportFixture(client: Client, cookies: string) {
	const uploadToken = await uploadTemporaryFile(
		cookies,
		HEVY_SAMPLE_CSV,
		"hevy-export.csv",
		"text/csv",
	);

	const result = await client.run((c) =>
		c.imports.createRun({ payload: { source: "hevy", uploadToken } }),
	);
	const runId = requirePresent(result.id, "Import run id is missing");

	const completedRun = await pollImportRunUntilTerminal(client, runId);
	return { runId, completedRun };
}
