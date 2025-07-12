import type { paths } from "@ryot/generated/openapi/app-backend";
import type { Client } from "./auth";

type CreateSavedViewBody = NonNullable<
	paths["/saved-views"]["post"]["requestBody"]
>["content"]["application/json"];
type UpdateSavedViewBody = NonNullable<
	paths["/saved-views/{viewId}"]["put"]["requestBody"]
>["content"]["application/json"];
type ReorderSavedViewsBody = NonNullable<
	paths["/saved-views/reorder"]["post"]["requestBody"]
>["content"]["application/json"];

const entityField = (schemaSlug: string, property: string) => {
	if (
		property === "name" ||
		property === "image" ||
		property === "createdAt" ||
		property === "updatedAt" ||
		property.startsWith("@")
	) {
		return `entity.${schemaSlug}.${property.startsWith("@") ? property : `@${property}`}`;
	}

	return `entity.${schemaSlug}.${property}`;
};

const defaultQueryDefinition = {
	filters: [],
	eventJoins: [],
	entitySchemaSlugs: ["book"],
	sort: { fields: [entityField("book", "name")], direction: "asc" },
} satisfies CreateSavedViewBody["queryDefinition"];

const defaultDisplayConfiguration = {
	table: {
		columns: [{ label: "Name", property: [entityField("book", "name")] }],
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
} satisfies CreateSavedViewBody["displayConfiguration"];

export function buildSavedViewBody(
	overrides: Partial<CreateSavedViewBody> = {},
): CreateSavedViewBody {
	return {
		icon: "star",
		accentColor: "#FF5733",
		queryDefinition: defaultQueryDefinition,
		name: `Saved View ${crypto.randomUUID()}`,
		displayConfiguration: defaultDisplayConfiguration,
		...overrides,
	};
}

export function buildUpdatedSavedViewBody(
	overrides: Partial<UpdateSavedViewBody> = {},
): UpdateSavedViewBody {
	return {
		icon: "heart",
		isDisabled: false,
		accentColor: "#00AA88",
		name: `Updated View ${crypto.randomUUID()}`,
		queryDefinition: {
			eventJoins: [],
			entitySchemaSlugs: ["book", "anime"],
			sort: { fields: [entityField("book", "createdAt")], direction: "desc" },
			filters: [
				{ op: "gte", field: entityField("book", "publishYear"), value: 2020 },
			],
		},
		displayConfiguration: {
			table: {
				columns: [
					{ label: "Name", property: [entityField("book", "name")] },
					{ label: "Year", property: [entityField("book", "publishYear")] },
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
		},
		...overrides,
	};
}

export async function createSavedView(
	client: Client,
	cookies: string,
	overrides: Partial<CreateSavedViewBody> = {},
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
	overrides: Partial<UpdateSavedViewBody> = {},
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
