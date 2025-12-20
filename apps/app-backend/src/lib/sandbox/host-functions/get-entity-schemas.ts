import { apiFailure, apiSuccess, type HostFunction } from "~/lib/sandbox/types";
import { listEntitySchemas } from "~/modules/entity-schemas/service";

type GetEntitySchemasContext = {
	userId: string;
};

type GetEntitySchemasDeps = {
	listEntitySchemas: typeof listEntitySchemas;
};

const getEntitySchemasDeps: GetEntitySchemasDeps = {
	listEntitySchemas,
};

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === "string");

export const createGetEntitySchemasHostFunction = (
	deps: GetEntitySchemasDeps = getEntitySchemasDeps,
): HostFunction<GetEntitySchemasContext> => {
	return async (context, slugs) => {
		if (typeof context.userId !== "string" || !context.userId.trim()) {
			return apiFailure(
				"getEntitySchemas requires a non-empty userId in context",
			);
		}

		if (!isStringArray(slugs)) {
			return apiFailure("getEntitySchemas expects slugs to be a string array");
		}

		const result = await deps.listEntitySchemas({
			slugs,
			userId: context.userId,
		});
		if ("error" in result) {
			return apiFailure(result.message);
		}

		return apiSuccess(result.data);
	};
};

export const getEntitySchemas = createGetEntitySchemasHostFunction();
