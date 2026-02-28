import type { StatusCode } from "hono/utils/http-status";
import { fromJSONSchema, z } from "zod";
import { paginatedResponse } from "~/lib/openapi";
import { positiveIntSchema } from "~/lib/zod/base";
import {
	getScriptById,
	upsertImportedEntity,
} from "~/modules/entity-schemas/repository";
import { getSandboxService } from "~/sandbox";
import {
	getAppConfigValue,
	getUserConfigValue,
} from "~/sandbox/host-functions";
import {
	importEnvelope,
	type SchemaImportBody,
	type SchemaSearchBody,
	schemaSearchItemSchema,
} from "./schemas";

const failure = (error: string, status: StatusCode) => ({
	error,
	status,
	success: false as const,
});

const success = <T>(data: T) => ({ data, success: true as const });

const sandboxSearchResponseSchema = z.object({
	items: z.array(schemaSearchItemSchema),
	details: z.object({
		nextPage: positiveIntSchema.nullish(),
		totalItems: z.number().int().nonnegative(),
	}),
});

const parseSandboxFailure = (
	result: { error?: string | null; logs?: string | null },
	label: string,
) => {
	if (result.error?.toLowerCase().includes("timed out"))
		return failure(`${label} job timed out`, 504);

	let errorMessage = `${label} script execution failed`;
	if (result.error) errorMessage = `${errorMessage}: ${result.error}`;
	if (result.logs) errorMessage = `${errorMessage}\n${result.logs}`;

	return failure(errorMessage, 500);
};

export const runSchemaSearch = async (input: {
	userId: string;
	body: SchemaSearchBody;
}) => {
	const script = await getScriptById(input.body.searchScriptId);
	if (!script) return failure("Search script not found", 404);

	const sandbox = getSandboxService();
	const result = await sandbox.run({
		code: script.code,
		userId: input.userId,
		apiFunctions: { getAppConfigValue, getUserConfigValue },
		context: {
			pageSize: 20,
			page: input.body.page,
			query: input.body.query,
			schemaSlug: script.schemaSlug,
		},
	});

	if (!result.success) return parseSandboxFailure(result, "Search");

	const parsedResult = sandboxSearchResponseSchema.safeParse(result.value);
	if (!parsedResult.success)
		return failure("Search script returned invalid payload", 500);

	return success(
		paginatedResponse(parsedResult.data.items, {
			page: input.body.page,
			total: parsedResult.data.details.totalItems,
			hasMore: parsedResult.data.details.nextPage !== null,
		}),
	);
};

const parseImportedPayload = (input: {
	propertiesSchema: unknown;
	sandboxValue: unknown;
}) => {
	const parsedEnvelope = importEnvelope.safeParse(input.sandboxValue);
	if (!parsedEnvelope.success) return null;

	const propertiesParser = (() => {
		try {
			return fromJSONSchema(
				input.propertiesSchema as Parameters<typeof fromJSONSchema>[0],
			);
		} catch {
			return null;
		}
	})();

	if (!propertiesParser) return null;

	const parsedProperties = propertiesParser.safeParse(
		parsedEnvelope.data.properties,
	);
	if (!parsedProperties.success) return null;

	const properties = parsedProperties.data;
	if (
		typeof properties !== "object" ||
		properties === null ||
		Array.isArray(properties)
	)
		return null;

	return {
		name: parsedEnvelope.data.name,
		externalId: parsedEnvelope.data.externalId,
		properties: properties as Record<string, unknown>,
	};
};

export const runSchemaImport = async (input: {
	userId: string;
	body: SchemaImportBody;
}) => {
	const script = await getScriptById(input.body.detailsScriptId);
	if (!script) return failure("Details script not found", 404);

	const sandbox = getSandboxService();
	const result = await sandbox.run({
		code: script.code,
		userId: input.userId,
		apiFunctions: { getAppConfigValue, getUserConfigValue },
		context: {
			schemaSlug: script.schemaSlug,
			identifier: input.body.identifier,
		},
	});

	if (!result.success) return parseSandboxFailure(result, "Import");

	const parsedPayload = parseImportedPayload({
		sandboxValue: result.value,
		propertiesSchema: script.propertiesSchema,
	});
	if (!parsedPayload)
		return failure("Import script returned invalid payload", 500);

	try {
		const persistedEntity = await upsertImportedEntity({
			userId: input.userId,
			payload: parsedPayload,
			entitySchemaId: script.schemaId,
			detailsSandboxScriptId: script.id,
		});

		return success(persistedEntity);
	} catch (error) {
		let errorMessage = "Import persistence failed";
		if (error instanceof Error)
			errorMessage = `${errorMessage}: ${error.message}`;
		return failure(errorMessage, 500);
	}
};
