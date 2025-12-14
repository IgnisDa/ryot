import { resolveRequiredSlug, resolveRequiredString } from "@ryot/ts-utils";
import { isUniqueConstraintError } from "~/lib/app/postgres";
import { authenticationBuiltinEntitySchemas } from "../authentication/bootstrap/manifests";
import { parseLabeledPropertySchemaInput } from "../property-schemas/service";
import {
	customTrackerError,
	resolveCustomTrackerAccess,
	resolveTrackerReadAccess,
	trackerNotFoundError,
} from "../trackers/access";
import { getTrackerScopeForUser } from "../trackers/repository";
import {
	createEntitySchemaForUser,
	getEntitySchemaByIdForUser,
	getEntitySchemaBySlugForUser,
	listEntitySchemasByTracker,
	listEntitySchemasForUser,
} from "./repository";
import type { CreateEntitySchemaBody, ListedEntitySchema } from "./schemas";

export type EntitySchemaPropertiesShape =
	CreateEntitySchemaBody["propertiesSchema"];

type EntitySchemaMutationError = "not_found" | "validation";

export type EntitySchemaServiceDeps = {
	getTrackerScopeForUser: typeof getTrackerScopeForUser;
	createEntitySchemaForUser: typeof createEntitySchemaForUser;
	listEntitySchemasByTracker: typeof listEntitySchemasByTracker;
	listEntitySchemasForUser: typeof listEntitySchemasForUser;
	getEntitySchemaByIdForUser: typeof getEntitySchemaByIdForUser;
	getEntitySchemaBySlugForUser: typeof getEntitySchemaBySlugForUser;
};

export type EntitySchemaServiceResult<T> =
	| { data: T }
	| { error: EntitySchemaMutationError; message: string };

const duplicateSlugError = "Entity schema slug already exists";
const entitySchemaNotFoundError = "Entity schema not found";
const entitySchemaUniqueConstraint = "entity_schema_user_slug_unique";

const entitySchemaServiceDeps: EntitySchemaServiceDeps = {
	createEntitySchemaForUser,
	getEntitySchemaByIdForUser,
	getEntitySchemaBySlugForUser,
	listEntitySchemasForUser,
	getTrackerScopeForUser,
	listEntitySchemasByTracker,
};

const createDataResult = <T>(data: T): EntitySchemaServiceResult<T> => ({
	data,
});

const createErrorResult = <T>(input: {
	error: EntitySchemaMutationError;
	message: string;
}): EntitySchemaServiceResult<T> => ({
	error: input.error,
	message: input.message,
});

const resolveEntitySchemaTrackerIdResult = (
	trackerId: string,
): EntitySchemaServiceResult<string> => {
	try {
		return createDataResult(resolveEntitySchemaTrackerId(trackerId));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Tracker id is required";
		return createErrorResult({ error: "validation", message });
	}
};

export const resolveEntitySchemaName = (name: string) =>
	resolveRequiredString(name, "Entity schema name");

export const resolveEntitySchemaTrackerId = (trackerId: string) =>
	resolveRequiredString(trackerId, "Tracker id");

export const resolveEntitySchemaIcon = (icon: string) =>
	resolveRequiredString(icon, "Entity schema icon");

export const resolveEntitySchemaAccentColor = (accentColor: string) =>
	resolveRequiredString(accentColor, "Entity schema accent color");

export const resolveEntitySchemaSlug = (
	input: Pick<CreateEntitySchemaBody, "name" | "slug">,
) => {
	return resolveRequiredSlug({
		name: input.name,
		slug: input.slug,
		label: "Entity schema",
	});
};

export const parseEntitySchemaPropertiesSchema = (
	input: unknown,
): EntitySchemaPropertiesShape => {
	return parseLabeledPropertySchemaInput(
		input,
		"Entity schema properties",
	) as EntitySchemaPropertiesShape;
};

export const validateSlugNotReserved = (slug: string): void => {
	const builtinEntitySchemas = authenticationBuiltinEntitySchemas();
	const reservedSlugs = builtinEntitySchemas.map((s) => s.slug);

	if (reservedSlugs.includes(slug)) {
		throw new Error(
			`Entity schema slug "${slug}" is reserved for built-in schemas`,
		);
	}
};

export const resolveEntitySchemaCreateInput = (
	input: Omit<CreateEntitySchemaBody, "trackerId">,
) => {
	const icon = resolveEntitySchemaIcon(input.icon);
	const name = resolveEntitySchemaName(input.name);
	const slug = resolveEntitySchemaSlug({ name, slug: input.slug });
	const accentColor = resolveEntitySchemaAccentColor(input.accentColor);
	const propertiesSchema = parseEntitySchemaPropertiesSchema(
		input.propertiesSchema,
	);

	validateSlugNotReserved(slug);

	return { icon, name, slug, accentColor, propertiesSchema };
};

const resolveEntitySchemaCreateInputResult = (
	input: Omit<CreateEntitySchemaBody, "trackerId">,
): EntitySchemaServiceResult<
	ReturnType<typeof resolveEntitySchemaCreateInput>
> => {
	try {
		return createDataResult(resolveEntitySchemaCreateInput(input));
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "Entity schema payload is invalid";
		return createErrorResult({ error: "validation", message });
	}
};

export const listEntitySchemas = async (
	input: { slugs?: string[]; trackerId?: string; userId: string },
	deps: EntitySchemaServiceDeps = entitySchemaServiceDeps,
): Promise<EntitySchemaServiceResult<ListedEntitySchema[]>> => {
	if (input.trackerId) {
		const trackerIdResult = resolveEntitySchemaTrackerIdResult(input.trackerId);
		if ("error" in trackerIdResult) {
			return trackerIdResult;
		}

		const foundTracker = resolveTrackerReadAccess(
			await deps.getTrackerScopeForUser({
				userId: input.userId,
				trackerId: trackerIdResult.data,
			}),
		);
		if (foundTracker.error) {
			return createErrorResult({
				error: "not_found",
				message: trackerNotFoundError,
			});
		}

		const entitySchemas = input.slugs?.length
			? await deps.listEntitySchemasForUser({
					slugs: input.slugs,
					userId: input.userId,
					trackerId: trackerIdResult.data,
				})
			: await deps.listEntitySchemasByTracker({
					trackerId: trackerIdResult.data,
				});
		return createDataResult(entitySchemas);
	}

	const entitySchemas = await deps.listEntitySchemasForUser({
		slugs: input.slugs,
		userId: input.userId,
	});
	return createDataResult(entitySchemas);
};

export const createEntitySchema = async (
	input: { body: CreateEntitySchemaBody; userId: string },
	deps: EntitySchemaServiceDeps = entitySchemaServiceDeps,
): Promise<EntitySchemaServiceResult<ListedEntitySchema>> => {
	const trackerIdResult = resolveEntitySchemaTrackerIdResult(
		input.body.trackerId,
	);
	if ("error" in trackerIdResult) {
		return trackerIdResult;
	}

	const foundTracker = resolveCustomTrackerAccess(
		await deps.getTrackerScopeForUser({
			userId: input.userId,
			trackerId: trackerIdResult.data,
		}),
	);
	if (foundTracker.error) {
		return createErrorResult({
			error: foundTracker.error === "not_found" ? "not_found" : "validation",
			message:
				foundTracker.error === "not_found"
					? trackerNotFoundError
					: customTrackerError,
		});
	}

	const entitySchemaInput = resolveEntitySchemaCreateInputResult({
		icon: input.body.icon,
		name: input.body.name,
		slug: input.body.slug,
		accentColor: input.body.accentColor,
		propertiesSchema: input.body.propertiesSchema,
	});
	if ("error" in entitySchemaInput) {
		return entitySchemaInput;
	}

	const existingEntitySchema = await deps.getEntitySchemaBySlugForUser({
		userId: input.userId,
		slug: entitySchemaInput.data.slug,
	});
	if (existingEntitySchema) {
		return createErrorResult({
			error: "validation",
			message: duplicateSlugError,
		});
	}

	try {
		const createdEntitySchema = await deps.createEntitySchemaForUser({
			userId: input.userId,
			trackerId: trackerIdResult.data,
			icon: entitySchemaInput.data.icon,
			name: entitySchemaInput.data.name,
			slug: entitySchemaInput.data.slug,
			accentColor: entitySchemaInput.data.accentColor,
			propertiesSchema: entitySchemaInput.data.propertiesSchema,
		});

		return createDataResult(createdEntitySchema);
	} catch (error) {
		if (isUniqueConstraintError(error, entitySchemaUniqueConstraint)) {
			return createErrorResult({
				error: "validation",
				message: duplicateSlugError,
			});
		}

		throw error;
	}
};

export const getEntitySchemaById = async (
	input: { entitySchemaId: string; userId: string },
	deps: EntitySchemaServiceDeps = entitySchemaServiceDeps,
): Promise<EntitySchemaServiceResult<ListedEntitySchema>> => {
	const foundEntitySchema = await deps.getEntitySchemaByIdForUser({
		userId: input.userId,
		entitySchemaId: input.entitySchemaId,
	});
	if (!foundEntitySchema) {
		return createErrorResult({
			error: "not_found",
			message: entitySchemaNotFoundError,
		});
	}

	return createDataResult(foundEntitySchema);
};
