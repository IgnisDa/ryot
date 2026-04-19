import type { paths } from "@ryot/generated/openapi/app-backend";
import { dayjs } from "@ryot/ts-utils";
import { Client as PgClient } from "pg";
import { getTestDatabaseUrl } from "../setup";
import type { Client } from "./auth";

type ImportMediaBody = NonNullable<
	paths["/media/import"]["post"]["requestBody"]
>["content"]["application/json"];

type PollMediaImportResponse =
	paths["/media/import/{jobId}"]["get"]["responses"][200]["content"]["application/json"]["data"];

export interface PollMediaImportOptions {
	timeoutMs?: number;
	intervalMs?: number;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function importMedia(
	client: Client,
	cookies: string,
	body: ImportMediaBody,
) {
	const { data, response } = await client.POST("/media/import", {
		body,
		headers: { Cookie: cookies },
	});

	if (response.status !== 200 || !data?.data?.jobId) {
		throw new Error("Failed to enqueue media import");
	}

	return { jobId: data.data.jobId };
}

export async function pollMediaImportResult(
	client: Client,
	cookies: string,
	jobId: string,
	options: PollMediaImportOptions = {},
) {
	const { intervalMs = 500, timeoutMs = 30_000 } = options;
	const deadline = dayjs().add(timeoutMs, "millisecond");

	for (;;) {
		const { data, response } = await client.GET("/media/import/{jobId}", {
			headers: { Cookie: cookies },
			params: { path: { jobId } },
		});

		if (response.status !== 200 || !data?.data) {
			throw new Error(`Failed to poll media import result '${jobId}'`);
		}

		const result: PollMediaImportResponse = data.data;
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
		`Media import job '${jobId}' did not reach a terminal state within ${timeoutMs}ms`,
	);
}

export async function seedMediaEntity(input: {
	name: string;
	externalId: string;
	userId?: string | null;
	entitySchemaId: string;
	sandboxScriptId: string | null;
	properties: Record<string, unknown>;
	image: Record<string, unknown> | null;
}) {
	const id = crypto.randomUUID();
	const pg = new PgClient({ connectionString: getTestDatabaseUrl() });

	await pg.connect();

	try {
		await pg.query(
			`insert into entity (
				id,
				name,
				image,
				user_id,
				properties,
				external_id,
				entity_schema_id,
				sandbox_script_id
			) values ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7, $8)`,
			[
				id,
				input.name,
				JSON.stringify(input.image),
				input.userId ?? null,
				JSON.stringify(input.properties),
				input.externalId,
				input.entitySchemaId,
				input.sandboxScriptId,
			],
		);
	} finally {
		await pg.end();
	}

	return {
		id,
		name: input.name,
		image: input.image,
		userId: input.userId ?? null,
		properties: input.properties,
		externalId: input.externalId,
		entitySchemaId: input.entitySchemaId,
		sandboxScriptId: input.sandboxScriptId,
	};
}
