import type { paths } from "@ryot/generated/openapi/app-backend";
import type { Client } from "./auth";
import {
	type ExpressionInput,
	entityColumnExpression,
	entityField,
	literalExpression,
	schemaPropertyExpression,
	toRequiredExpression,
} from "./view-language";

type CreateSavedViewBody = NonNullable<
	paths["/saved-views"]["post"]["requestBody"]
>["content"]["application/json"];
type UpdateSavedViewBody = NonNullable<
	paths["/saved-views/{viewId}"]["put"]["requestBody"]
>["content"]["application/json"];
type ReorderSavedViewsBody = NonNullable<
	paths["/saved-views/reorder"]["post"]["requestBody"]
>["content"]["application/json"];
type QueryDefinition = CreateSavedViewBody["queryDefinition"];
type DisplayConfiguration = CreateSavedViewBody["displayConfiguration"];

type CreateSavedViewInput = Partial<
	Omit<CreateSavedViewBody, "displayConfiguration" | "queryDefinition">
> & {
	displayConfiguration?: DisplayConfigurationInput;
	queryDefinition?: QueryDefinition;
};

type UpdateSavedViewInput = Partial<
	Omit<UpdateSavedViewBody, "displayConfiguration" | "queryDefinition">
> & {
	queryDefinition?: QueryDefinition;
	displayConfiguration?: DisplayConfigurationInput;
};

type DisplayColumnInput = {
	label: string;
	property?: string[];
	expression?: ExpressionInput;
};

type DisplayConfigurationInput = {
	table: { columns: DisplayColumnInput[] };
	grid: {
		badgeProperty: ExpressionInput | null;
		titleProperty: ExpressionInput | null;
		imageProperty: ExpressionInput | null;
		subtitleProperty: ExpressionInput | null;
	};
	list: {
		badgeProperty: ExpressionInput | null;
		titleProperty: ExpressionInput | null;
		imageProperty: ExpressionInput | null;
		subtitleProperty: ExpressionInput | null;
	};
};

const normalizeDisplayConfiguration = (
	input: DisplayConfigurationInput,
	allowNulls = true,
): DisplayConfiguration => ({
	grid: {
		badgeProperty:
			(input.grid.badgeProperty === null && allowNulls
				? null
				: toRequiredExpression(input.grid.badgeProperty)) ?? null,
		titleProperty:
			(input.grid.titleProperty === null && allowNulls
				? null
				: toRequiredExpression(input.grid.titleProperty)) ?? null,
		imageProperty:
			(input.grid.imageProperty === null && allowNulls
				? null
				: toRequiredExpression(input.grid.imageProperty)) ?? null,
		subtitleProperty:
			(input.grid.subtitleProperty === null && allowNulls
				? null
				: toRequiredExpression(input.grid.subtitleProperty)) ?? null,
	},
	list: {
		badgeProperty:
			(input.list.badgeProperty === null && allowNulls
				? null
				: toRequiredExpression(input.list.badgeProperty)) ?? null,
		titleProperty:
			(input.list.titleProperty === null && allowNulls
				? null
				: toRequiredExpression(input.list.titleProperty)) ?? null,
		imageProperty:
			(input.list.imageProperty === null && allowNulls
				? null
				: toRequiredExpression(input.list.imageProperty)) ?? null,
		subtitleProperty:
			(input.list.subtitleProperty === null && allowNulls
				? null
				: toRequiredExpression(input.list.subtitleProperty)) ?? null,
	},
	table: {
		columns: input.table.columns.map((column) => ({
			label: column.label,
			expression: toRequiredExpression(
				column.expression ?? column.property ?? [],
			),
		})),
	},
});

const defaultQueryDefinition: QueryDefinition = {
	filter: null,
	eventJoins: [],
	computedFields: [],
	entitySchemaSlugs: ["book"],
	sort: {
		direction: "asc",
		expression: toRequiredExpression([entityField("book", "name")]),
	},
};

const defaultDisplayConfiguration = {
	table: {
		columns: [{ label: "Name", expression: [entityField("book", "name")] }],
	},
	grid: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: [entityField("book", "name")],
		imageProperty: [entityField("book", "image")],
	},
	list: {
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: [entityField("book", "name")],
		imageProperty: [entityField("book", "image")],
	},
} satisfies DisplayConfigurationInput;

const defaultUpdatedQueryDefinition: QueryDefinition = {
	eventJoins: [],
	computedFields: [],
	entitySchemaSlugs: ["book", "anime"],
	sort: {
		direction: "desc",
		expression: entityColumnExpression("book", "createdAt"),
	},
	filter: {
		operator: "gte",
		type: "comparison",
		right: literalExpression(2020),
		left: schemaPropertyExpression("book", "publishYear"),
	},
};

export function buildSavedViewBody(
	overrides: CreateSavedViewInput = {},
): CreateSavedViewBody {
	const {
		displayConfiguration: displayOverride,
		queryDefinition,
		...rest
	} = overrides;
	const displayConfiguration = displayOverride
		? normalizeDisplayConfiguration(displayOverride)
		: normalizeDisplayConfiguration(defaultDisplayConfiguration);

	return {
		icon: "star",
		accentColor: "#FF5733",
		name: `Saved View ${crypto.randomUUID()}`,
		...rest,
		displayConfiguration,
		queryDefinition: queryDefinition ?? defaultQueryDefinition,
	};
}

export function buildUpdatedSavedViewBody(
	overrides: UpdateSavedViewInput = {},
): UpdateSavedViewBody {
	const {
		displayConfiguration: displayOverride,
		queryDefinition,
		...rest
	} = overrides;
	const displayConfiguration = displayOverride
		? normalizeDisplayConfiguration(displayOverride, false)
		: normalizeDisplayConfiguration({
				table: {
					columns: [
						{ label: "Name", expression: [entityField("book", "name")] },
						{ label: "Year", expression: [entityField("book", "publishYear")] },
					],
				},
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					titleProperty: [entityField("book", "name")],
					imageProperty: [entityField("book", "image")],
					subtitleProperty: [entityField("book", "publishYear")],
					badgeProperty: [entityField("anime", "productionStatus")],
				},
			});

	return {
		icon: "heart",
		isDisabled: false,
		accentColor: "#00AA88",
		name: `Updated View ${crypto.randomUUID()}`,
		...rest,
		queryDefinition: queryDefinition ?? defaultUpdatedQueryDefinition,
		displayConfiguration,
	};
}

export async function createSavedView(
	client: Client,
	cookies: string,
	overrides: CreateSavedViewInput = {},
) {
	const { data, response } = await client.POST("/saved-views", {
		headers: { Cookie: cookies },
		body: buildSavedViewBody(overrides),
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error("Failed to create saved view");
	}

	return data.data;
}

export async function listSavedViews(
	client: Client,
	cookies: string,
	options: { trackerId?: string; includeDisabled?: boolean } = {},
) {
	const includeDisabled = options.includeDisabled ? "true" : undefined;
	const { data, response } = await client.GET("/saved-views", {
		headers: { Cookie: cookies },
		params: { query: { includeDisabled, trackerId: options.trackerId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error("Failed to list saved views");
	}

	return data.data;
}

export async function findBuiltinSavedView(client: Client, cookies: string) {
	const views = await listSavedViews(client, cookies);
	const builtinView = views.find((view) => view.isBuiltin);

	if (!builtinView) {
		throw new Error("Built-in saved view not found");
	}

	return builtinView;
}

export async function getSavedView(
	client: Client,
	cookies: string,
	viewId: string,
) {
	const { data, response } = await client.GET("/saved-views/{viewId}", {
		headers: { Cookie: cookies },
		params: { path: { viewId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to get saved view '${viewId}'`);
	}

	return data.data;
}

export async function updateSavedView(
	client: Client,
	cookies: string,
	viewId: string,
	overrides: UpdateSavedViewInput = {},
) {
	const { data, response } = await client.PUT("/saved-views/{viewId}", {
		headers: { Cookie: cookies },
		params: { path: { viewId } },
		body: buildUpdatedSavedViewBody(overrides),
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to update saved view '${viewId}'`);
	}

	return data.data;
}

export async function cloneSavedView(
	client: Client,
	cookies: string,
	viewId: string,
) {
	const { data, response } = await client.POST("/saved-views/{viewId}/clone", {
		headers: { Cookie: cookies },
		params: { path: { viewId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to clone saved view '${viewId}'`);
	}

	return data.data;
}

export async function deleteSavedView(
	client: Client,
	cookies: string,
	viewId: string,
) {
	const { data, response } = await client.DELETE("/saved-views/{viewId}", {
		headers: { Cookie: cookies },
		params: { path: { viewId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to delete saved view '${viewId}'`);
	}

	return data.data;
}

export async function reorderSavedViews(
	client: Client,
	cookies: string,
	body: ReorderSavedViewsBody,
) {
	const { data, response } = await client.POST("/saved-views/reorder", {
		body,
		headers: { Cookie: cookies },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error("Failed to reorder saved views");
	}

	return data.data;
}
