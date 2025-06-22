import type { AppSchema } from "@ryot/ts-utils";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "~/lib/db";
import { entitySchema } from "~/lib/db/schema";
import { ViewRuntimeNotFoundError, ViewRuntimeValidationError } from "./errors";
import {
	buildSchemaMap,
	getPropertyType,
	getSchemaForReference,
	resolveRuntimeReference,
	type ViewRuntimeSchemaLike,
} from "./reference";

type CardDisplayConfig = {
	imageProperty: string[] | null;
	titleProperty: string[] | null;
	badgeProperty: string[] | null;
	subtitleProperty: string[] | null;
};

type TableDisplayConfig = {
	columns: Array<{ property: string[] }>;
};

type SortConfig = {
	fields: string[];
	direction: string;
};

type FilterConfig = {
	field: string;
};

type LocalRuntimeRequest =
	| {
			layout: "grid";
			sort: SortConfig;
			filters: FilterConfig[];
			entitySchemaSlugs: string[];
			displayConfiguration: CardDisplayConfig;
	  }
	| {
			layout: "list";
			sort: SortConfig;
			filters: FilterConfig[];
			entitySchemaSlugs: string[];
			displayConfiguration: CardDisplayConfig;
	  }
	| {
			layout: "table";
			sort: SortConfig;
			filters: FilterConfig[];
			entitySchemaSlugs: string[];
			displayConfiguration: TableDisplayConfig;
	  };

type SavedViewValidationInput = {
	displayConfiguration: {
		grid: CardDisplayConfig;
		list: CardDisplayConfig;
		table: TableDisplayConfig;
	};
	queryDefinition: {
		sort: SortConfig;
		filters: FilterConfig[];
		entitySchemaSlugs: string[];
	};
};

type ValidationSchemaRow = ViewRuntimeSchemaLike;

const SORT_FILTER_VALID_BUILTINS: ReadonlySet<string> = new Set([
	"name",
	"createdAt",
	"updatedAt",
]);

const DISPLAY_VALID_BUILTINS: ReadonlySet<string> = new Set([
	"name",
	"image",
	"createdAt",
	"updatedAt",
]);

const fetchSchemasForValidation = async (input: {
	userId: string;
	entitySchemaSlugs: string[];
}): Promise<ValidationSchemaRow[]> => {
	const uniqueSlugs = [...new Set(input.entitySchemaSlugs)];

	const rows = await db
		.select({
			slug: entitySchema.slug,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(entitySchema)
		.where(
			and(
				inArray(entitySchema.slug, uniqueSlugs),
				or(isNull(entitySchema.userId), eq(entitySchema.userId, input.userId)),
			),
		);

	const schemas = rows.map((row) => ({
		slug: row.slug,
		propertiesSchema: row.propertiesSchema as AppSchema,
	}));

	const foundSlugs = new Set(schemas.map((s) => s.slug));
	for (const slug of uniqueSlugs) {
		if (!foundSlugs.has(slug)) {
			throw new ViewRuntimeNotFoundError(`Schema '${slug}' not found`);
		}
	}

	return schemas;
};

export const validateReferenceAgainstSchemas = (
	reference: string,
	schemaMap: Map<string, ValidationSchemaRow>,
	validBuiltins: ReadonlySet<string>,
): void => {
	const parsed = resolveRuntimeReference(reference);

	if (parsed.type === "top-level") {
		if (!validBuiltins.has(parsed.column)) {
			throw new ViewRuntimeValidationError(
				`Unsupported column '@${parsed.column}'`,
			);
		}
		return;
	}

	const schema = getSchemaForReference(schemaMap, parsed);
	const propertyType = getPropertyType(schema, parsed.property);
	if (!propertyType) {
		throw new ViewRuntimeValidationError(
			`Property '${parsed.property}' not found in schema '${parsed.slug}'`,
		);
	}
};

export const validateViewRuntimeReferences = (
	request: LocalRuntimeRequest,
	schemaMap: Map<string, ValidationSchemaRow>,
): void => {
	for (const field of request.sort.fields) {
		validateReferenceAgainstSchemas(
			field,
			schemaMap,
			SORT_FILTER_VALID_BUILTINS,
		);
	}

	for (const filter of request.filters) {
		validateReferenceAgainstSchemas(
			filter.field,
			schemaMap,
			SORT_FILTER_VALID_BUILTINS,
		);
	}

	if (request.layout === "table") {
		for (const column of request.displayConfiguration.columns) {
			for (const reference of column.property) {
				validateReferenceAgainstSchemas(
					reference,
					schemaMap,
					DISPLAY_VALID_BUILTINS,
				);
			}
		}
		return;
	}

	const dc = request.displayConfiguration;
	for (const refs of [
		dc.imageProperty,
		dc.titleProperty,
		dc.badgeProperty,
		dc.subtitleProperty,
	]) {
		for (const reference of refs ?? []) {
			validateReferenceAgainstSchemas(
				reference,
				schemaMap,
				DISPLAY_VALID_BUILTINS,
			);
		}
	}
};

export const validateSavedViewBody = async <T extends SavedViewValidationInput>(
	body: T,
	userId: string,
): Promise<void> => {
	const { sort, filters, entitySchemaSlugs } = body.queryDefinition;

	const runtimeRequests: LocalRuntimeRequest[] = [
		{
			sort,
			filters,
			layout: "grid",
			entitySchemaSlugs,
			displayConfiguration: body.displayConfiguration.grid,
		},
		{
			sort,
			filters,
			layout: "list",
			entitySchemaSlugs,
			displayConfiguration: body.displayConfiguration.list,
		},
		{
			sort,
			filters,
			layout: "table",
			entitySchemaSlugs,
			displayConfiguration: body.displayConfiguration.table,
		},
	];

	const schemas = await fetchSchemasForValidation({
		userId,
		entitySchemaSlugs,
	});
	const schemaMap = buildSchemaMap(schemas);

	for (const request of runtimeRequests) {
		validateViewRuntimeReferences(request, schemaMap);
	}
};
