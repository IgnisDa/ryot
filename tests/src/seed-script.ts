// TODO: delete this file eventually
import { faker } from "@faker-js/faker";
import type { components, paths } from "@ryot/generated/openapi/app-backend";
import { dayjs } from "@ryot/ts-utils";
import createClient from "openapi-fetch";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8000/api";

async function createAndSignIn(): Promise<{
	cookies: string;
	email: string;
	password: string;
}> {
	const email = `seed-${dayjs().valueOf()}@example.com`;
	const password = email;

	const signUpResponse = await fetch(`${API_BASE_URL}/authentication/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, name: "Seed User", password }),
	});

	if (!signUpResponse.ok) {
		const error = await signUpResponse.text();
		throw new Error(`Sign up failed: ${error}`);
	}

	const signInResponse = await fetch(`${API_BASE_URL}/auth/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});

	if (!signInResponse.ok) {
		const error = await signInResponse.text();
		throw new Error(`Sign in failed: ${error}`);
	}

	const cookies = signInResponse.headers.get("set-cookie");
	if (!cookies) {
		throw new Error("Sign in succeeded but no cookies were returned");
	}

	return { cookies, email, password };
}

type Client = ReturnType<typeof createClient<paths>>;
type CreateCollectionBody = {
	name: string;
	description?: string;
	membershipPropertiesSchema?: Record<string, unknown>;
};
type AddToCollectionBody = NonNullable<
	paths["/collections/memberships"]["post"]["requestBody"]
>["content"]["application/json"];
type CreateSavedViewBody = NonNullable<
	paths["/saved-views"]["post"]["requestBody"]
>["content"]["application/json"];
type SavedViewQueryDefinition = CreateSavedViewBody["queryDefinition"];
type SavedViewQueryInput = {
	entitySchemaSlugs: string[];
	eventJoins?: SavedViewQueryDefinition["eventJoins"];
	computedFields?: SavedViewQueryDefinition["computedFields"];
	filter?: SavedViewQueryDefinition["filter"];
	filters?: Array<{
		op:
			| "eq"
			| "neq"
			| "gt"
			| "gte"
			| "lt"
			| "lte"
			| "in"
			| "contains"
			| "isNull"
			| "isNotNull";
		field: string;
		value?: unknown;
	}>;
	sort:
		| SavedViewQueryDefinition["sort"]
		| { direction: "asc" | "desc"; fields: string[] };
};
type SavedViewDisplayConfiguration =
	CreateSavedViewBody["displayConfiguration"];
type SavedViewTableColumn = {
	label: string;
	expression?: SavedViewDisplayConfiguration["table"]["columns"][number]["expression"];
	property?: string[];
};
type SavedViewExpression = SavedViewQueryDefinition["sort"]["expression"];
type SavedViewPredicate = NonNullable<SavedViewQueryDefinition["filter"]>;
type SavedViewQueryEngineRef = Extract<
	SavedViewExpression,
	{ type: "reference" }
>["reference"];
type ComputedFieldDef = NonNullable<
	SavedViewQueryDefinition["computedFields"]
>[number];
type EventJoinDef = NonNullable<SavedViewQueryDefinition["eventJoins"]>[number];
type SavedViewSortInput = Extract<
	SavedViewQueryInput["sort"],
	{ fields: string[] }
>;
type SavedViewDisplayConfigInput = {
	grid: {
		imageProperty: string[] | null;
		titleProperty: string[] | null;
		badgeProperty: string[] | null;
		subtitleProperty: string[] | null;
	};
	list: {
		imageProperty: string[] | null;
		titleProperty: string[] | null;
		badgeProperty: string[] | null;
		subtitleProperty: string[] | null;
	};
	table: { columns: SavedViewTableColumn[] };
};

type SavedViewSpec = {
	name: string;
	icon: string;
	trackerId?: string;
	accentColor: string;
	queryDefinition: SavedViewQueryInput;
	displayConfiguration: SavedViewDisplayConfigInput;
};

type PropertiesSchemaField = {
	type: string;
	label?: string;
	items?: PropertiesSchemaField;
	unknownKeys?: string;
	transform?: Record<string, unknown>;
	validation?: Record<string, unknown>;
	properties?: Record<string, PropertiesSchemaField>;
};

type PropertiesSchema = {
	fields: Record<string, PropertiesSchemaField>;
	rules?: components["schemas"]["AppSchemaRule"][];
};

class APIClient {
	private client: Client;
	private requestCount = 0;

	constructor(cookies: string) {
		this.client = createClient<paths>({
			baseUrl: API_BASE_URL,
			headers: { Cookie: cookies },
		});
	}

	getClient(): Client {
		return this.client;
	}

	incrementRequestCount(): void {
		this.requestCount++;
	}

	getRequestCount(): number {
		return this.requestCount;
	}
}

function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(array: T[]) {
	return array[Math.floor(Math.random() * array.length)] as T;
}

function generateImageUrl(seed: string, width: number, height: number): string {
	return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`;
}

async function createTracker(
	apiClient: APIClient,
	name: string,
	slug: string,
	icon: string,
	accentColor: string,
	description?: string,
) {
	console.log(`  Creating tracker: ${name}...`);
	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { data, response } = await client.POST("/trackers", {
		body: { name, slug, icon, accentColor, description },
	});

	if (!response.ok || !data?.data) {
		throw new Error(`Failed to create tracker: ${response.statusText}`);
	}

	console.log(`  ✓ Created tracker: ${name} (${data.data.id})`);
	return data.data;
}

async function createEntitySchema(
	apiClient: APIClient,
	name: string,
	slug: string,
	trackerId: string,
	icon: string,
	accentColor: string,
	propertiesSchema: PropertiesSchema,
) {
	console.log(`    Creating entity schema: ${name}...`);
	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { data, response } = await client.POST("/entity-schemas", {
		body: {
			name,
			slug,
			icon,
			trackerId,
			accentColor,
			propertiesSchema,
		} as never,
	});

	if (!response.ok || !data?.data) {
		throw new Error(`Failed to create entity schema: ${response.statusText}`);
	}

	console.log(`    ✓ Created entity schema: ${name} (${data.data.id})`);
	return data.data;
}

async function createEventSchema(
	apiClient: APIClient,
	name: string,
	slug: string,
	entitySchemaId: string,
	propertiesSchema: PropertiesSchema,
) {
	console.log(`      Creating event schema: ${name}...`);
	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { data, response } = await client.POST("/event-schemas", {
		body: { name, slug, entitySchemaId, propertiesSchema } as never,
	});

	if (!response.ok || !data?.data) {
		throw new Error(`Failed to create event schema: ${response.statusText}`);
	}

	console.log(`      ✓ Created event schema: ${name} (${data.data.id})`);
	return data.data;
}

async function createEntity(
	apiClient: APIClient,
	name: string,
	entitySchemaId: string,
	properties: Record<string, unknown>,
	imageUrl: string | null,
) {
	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { data, response } = await client.POST("/entities", {
		body: {
			name,
			properties,
			entitySchemaId,
			image: imageUrl ? { kind: "remote", url: imageUrl } : null,
		},
	});

	if (!response.ok || !data?.data) {
		throw new Error(`Failed to create entity: ${response.statusText}`);
	}

	return data.data;
}

async function createCollection(
	apiClient: APIClient,
	body: CreateCollectionBody,
) {
	console.log(`  Creating collection: ${body.name}...`);
	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { data, error, response } = await client.POST("/collections", {
		body: body as never,
	});

	if (!response.ok || !data?.data) {
		const details = error ? ` ${JSON.stringify(error)}` : "";
		throw new Error(
			`Failed to create collection '${body.name}': ${response.status} ${response.statusText}${details}`,
		);
	}

	console.log(`  ✓ Created collection: ${body.name} (${data.data.id})`);
	return data.data;
}

async function addEntityToCollection(
	apiClient: APIClient,
	body: AddToCollectionBody,
) {
	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { data, error, response } = await client.POST(
		"/collections/memberships",
		{ body },
	);

	if (!response.ok || !data?.data) {
		const details = error ? ` ${JSON.stringify(error)}` : "";
		throw new Error(
			`Failed to add entity '${body.entityId}' to collection '${body.collectionId}': ${response.status} ${response.statusText}${details}`,
		);
	}

	return data.data;
}

type SeedEntity = Awaited<ReturnType<typeof createEntity>>;

type EventPayload = NonNullable<
	paths["/events"]["post"]["requestBody"]
>["content"]["application/json"][number];

async function createEvents(
	apiClient: APIClient,
	events: EventPayload[],
): Promise<void> {
	if (events.length === 0) {
		return;
	}
	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { data, response } = await client.POST("/events", { body: events });

	if (!response.ok) {
		const details = data ? ` ${JSON.stringify(data)}` : "";
		throw new Error(
			`Failed to create events: ${response.statusText}${details}`,
		);
	}
}

async function createSavedView(
	apiClient: APIClient,
	name: string,
	icon: string,
	accentColor: string,
	queryDefinition: SavedViewQueryInput,
	displayConfiguration: SavedViewDisplayConfigInput,
	trackerId?: string,
) {
	const literalExpression = (value: unknown | null): SavedViewExpression => ({
		type: "literal",
		value,
	});

	const parseReference = (reference: string): SavedViewQueryEngineRef => {
		const segments = reference.split(".");
		const [namespace, segment, third, ...rest] = segments;

		if (namespace === "computed") {
			if (!segment || third !== undefined) {
				throw new Error(`Invalid saved view reference '${reference}'`);
			}

			return { type: "computed-field", key: segment };
		}

		if (namespace === "entity") {
			if (!segment || !third) {
				throw new Error(`Invalid saved view reference '${reference}'`);
			}

			if (third === "properties") {
				if (rest.length === 0) {
					throw new Error(`Invalid saved view reference '${reference}'`);
				}

				return { type: "entity", slug: segment, path: [third, ...rest] };
			}

			if (rest.length > 0) {
				throw new Error(`Invalid saved view reference '${reference}'`);
			}

			return { type: "entity", slug: segment, path: [third] };
		}

		if (namespace === "event") {
			if (!segment || !third) {
				throw new Error(`Invalid saved view reference '${reference}'`);
			}

			if (third === "properties") {
				if (rest.length === 0) {
					throw new Error(`Invalid saved view reference '${reference}'`);
				}

				return { type: "event", joinKey: segment, path: [third, ...rest] };
			}

			if (rest.length > 0) {
				throw new Error(`Invalid saved view reference '${reference}'`);
			}

			return { type: "event", joinKey: segment, path: [third] };
		}

		throw new Error(`Invalid saved view reference '${reference}'`);
	};

	const toExpression = (
		input: string[] | SavedViewExpression | null,
	): SavedViewExpression | null => {
		if (input === null) {
			return null;
		}

		if (!Array.isArray(input)) {
			return input;
		}

		if (!input.length) {
			return literalExpression(null);
		}

		const normalizeReference = (value: string) => {
			if (value.startsWith("@")) {
				return expandEntityBuiltinReference(value);
			}
			if (
				!value.startsWith("entity.") &&
				!value.startsWith("event.") &&
				!value.startsWith("computed.") &&
				value.split(".").length === 2
			) {
				const [schemaSlug, prop] = value.split(".");
				return [`entity.${schemaSlug}.properties.${prop}`];
			}
			return [value];
		};

		const values = input
			.flatMap((reference) => normalizeReference(reference))
			.map((reference) => ({
				type: "reference" as const,
				reference: parseReference(reference),
			}));

		return values.length === 1
			? (values[0] ?? literalExpression(null))
			: { type: "coalesce", values };
	};

	const expandEntityBuiltinReference = (value: string) => {
		if (!value.startsWith("@")) {
			return [value];
		}

		const column = value.slice(1);
		return queryDefinition.entitySchemaSlugs.map((schemaSlug) => {
			return `entity.${schemaSlug}.${column}`;
		});
	};

	const normalizeFilterReference = (value: string) => {
		if (value.startsWith("event.") || value.startsWith("entity.")) {
			return value;
		}

		if (value.startsWith("@")) {
			if (queryDefinition.entitySchemaSlugs.length !== 1) {
				throw new Error(
					`Cannot normalize ambiguous filter reference '${value}' for saved view '${name}'`,
				);
			}

			const column = value.slice(1);
			return `entity.${queryDefinition.entitySchemaSlugs[0]}.${column}`;
		}

		if (value.split(".").length === 2) {
			const [schemaSlug, prop] = value.split(".");
			return `entity.${schemaSlug}.properties.${prop}`;
		}

		return value;
	};

	const normalizeSortFields = (values: string[]) => {
		return values.flatMap((value) => {
			if (value.startsWith("event.") || value.startsWith("entity.")) {
				return [value];
			}

			if (value.startsWith("@")) {
				return expandEntityBuiltinReference(value);
			}

			if (value.split(".").length === 2) {
				const [schemaSlug, prop] = value.split(".");
				return [`entity.${schemaSlug}.properties.${prop}`];
			}

			return [value];
		});
	};

	const toPredicate = (
		filter: NonNullable<SavedViewQueryInput["filters"]>[number],
	) => {
		const expression =
			toExpression([normalizeFilterReference(filter.field)]) ??
			literalExpression(null);
		if (filter.op === "isNull") {
			return { type: "isNull", expression } satisfies SavedViewPredicate;
		}

		if (filter.op === "isNotNull") {
			return { type: "isNotNull", expression } satisfies SavedViewPredicate;
		}

		if (filter.op === "contains") {
			return {
				type: "contains",
				expression,
				value: literalExpression(filter.value ?? null),
			} satisfies SavedViewPredicate;
		}

		if (filter.op === "in") {
			return {
				type: "in",
				expression,
				values: Array.isArray(filter.value)
					? filter.value.map((value) => literalExpression(value))
					: [literalExpression(filter.value ?? null)],
			} satisfies SavedViewPredicate;
		}

		return {
			type: "comparison",
			left: expression,
			right: literalExpression(filter.value ?? null),
			operator: filter.op,
		} satisfies SavedViewPredicate;
	};

	const getFilterGroupKey = (
		filter: NonNullable<SavedViewQueryInput["filters"]>[number],
	) => {
		const reference = parseReference(normalizeFilterReference(filter.field));
		return reference.type === "entity"
			? reference.slug
			: `${reference.type}:${JSON.stringify(reference)}`;
	};

	const combinePredicates = (
		predicates: SavedViewPredicate[],
		type: "and" | "or",
	) => {
		if (!predicates.length) {
			return null;
		}

		if (predicates.length === 1) {
			return predicates[0] ?? null;
		}

		return { type, predicates } satisfies SavedViewPredicate;
	};

	const toFilterPredicate = (): SavedViewQueryDefinition["filter"] => {
		if (queryDefinition.filter !== undefined) {
			return queryDefinition.filter;
		}

		if (!queryDefinition.filters?.length) {
			return null;
		}

		const grouped = new Map<string, SavedViewPredicate[]>();
		for (const filter of queryDefinition.filters) {
			const key = getFilterGroupKey(filter);
			const existing = grouped.get(key) ?? [];
			existing.push(toPredicate(filter));
			grouped.set(key, existing);
		}

		const groupedPredicates = Array.from(grouped.values())
			.map((predicates) => combinePredicates(predicates, "and"))
			.filter(
				(predicate): predicate is SavedViewPredicate => predicate !== null,
			);

		return combinePredicates(groupedPredicates, "or");
	};

	const normalizedQueryDefinition = {
		computedFields: queryDefinition.computedFields ?? [],
		eventJoins: queryDefinition.eventJoins ?? [],
		entitySchemaSlugs: queryDefinition.entitySchemaSlugs,
		filter: toFilterPredicate(),
		sort: {
			direction: queryDefinition.sort.direction,
			expression:
				"expression" in queryDefinition.sort
					? queryDefinition.sort.expression
					: (toExpression(
							normalizeSortFields(
								(queryDefinition.sort as SavedViewSortInput).fields,
							),
						) ?? literalExpression(null)),
		},
	} satisfies SavedViewQueryDefinition;
	const normalizedDisplayConfiguration: SavedViewDisplayConfiguration = {
		grid: {
			...displayConfiguration.grid,
			imageProperty:
				toExpression(displayConfiguration.grid.imageProperty) ?? null,
			titleProperty:
				toExpression(displayConfiguration.grid.titleProperty) ?? null,
			badgeProperty:
				toExpression(displayConfiguration.grid.badgeProperty) ?? null,
			subtitleProperty:
				toExpression(displayConfiguration.grid.subtitleProperty) ?? null,
		},
		list: {
			...displayConfiguration.list,
			imageProperty:
				toExpression(displayConfiguration.list.imageProperty) ?? null,
			titleProperty:
				toExpression(displayConfiguration.list.titleProperty) ?? null,
			badgeProperty:
				toExpression(displayConfiguration.list.badgeProperty) ?? null,
			subtitleProperty:
				toExpression(displayConfiguration.list.subtitleProperty) ?? null,
		},
		table: {
			columns: displayConfiguration.table.columns.map((column) => ({
				label: column.label,
				expression:
					toExpression(column.property ?? column.expression ?? null) ??
					literalExpression(null),
			})),
		},
	};

	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { data, error, response } = await client.POST("/saved-views", {
		body: {
			name,
			icon,
			accentColor,
			trackerId,
			queryDefinition: normalizedQueryDefinition,
			displayConfiguration: normalizedDisplayConfiguration,
		},
	});

	if (!response.ok || !data?.data) {
		const details = error ? ` ${JSON.stringify(error)}` : "";
		throw new Error(
			`Failed to create saved view: ${response.status} ${response.statusText}${details}`,
		);
	}

	return data.data;
}

// ─── Expression builders ────────────────────────────────────────────────────

function ref(reference: SavedViewQueryEngineRef): SavedViewExpression {
	return { type: "reference", reference };
}

function literal(value: unknown): SavedViewExpression {
	return { type: "literal", value };
}

function schemaProp(slug: string, property: string): SavedViewExpression {
	return ref({ type: "entity", slug, path: ["properties", property] });
}

export function computedRef(key: string): SavedViewExpression {
	return ref({ type: "computed-field", key });
}

function eventProp(joinKey: string, property: string): SavedViewExpression {
	return ref({ type: "event", joinKey, path: ["properties", property] });
}

function eventCol(joinKey: string, column: string): SavedViewExpression {
	return ref({ type: "event", joinKey, path: [column] });
}

function arithmetic(
	operator: "add" | "subtract" | "multiply" | "divide",
	left: SavedViewExpression,
	right: SavedViewExpression,
): SavedViewExpression {
	return { type: "arithmetic", operator, left, right };
}

function concat(...values: SavedViewExpression[]): SavedViewExpression {
	return { type: "concat", values };
}

function conditional(
	condition: SavedViewPredicate,
	whenTrue: SavedViewExpression,
	whenFalse: SavedViewExpression,
): SavedViewExpression {
	return { type: "conditional", condition, whenTrue, whenFalse };
}

function roundExpr(expression: SavedViewExpression): SavedViewExpression {
	return { type: "round", expression };
}

function coalesceExpr(...values: SavedViewExpression[]): SavedViewExpression {
	return { type: "coalesce", values };
}

// ─── Predicate builders ─────────────────────────────────────────────────────

function compare(
	operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
	left: SavedViewExpression,
	right: SavedViewExpression,
): SavedViewPredicate {
	return { type: "comparison", operator, left, right };
}

function inPred(
	expression: SavedViewExpression,
	values: SavedViewExpression[],
): SavedViewPredicate {
	return { type: "in", expression, values };
}

function isNullPred(expression: SavedViewExpression): SavedViewPredicate {
	return { type: "isNull", expression };
}

function isNotNullPred(expression: SavedViewExpression): SavedViewPredicate {
	return { type: "isNotNull", expression };
}

function containsPred(
	expression: SavedViewExpression,
	value: SavedViewExpression,
): SavedViewPredicate {
	return { type: "contains", expression, value };
}

function andPred(...predicates: SavedViewPredicate[]): SavedViewPredicate {
	return { type: "and", predicates };
}

function orPred(...predicates: SavedViewPredicate[]): SavedViewPredicate {
	return { type: "or", predicates };
}

function notPred(predicate: SavedViewPredicate): SavedViewPredicate {
	return { type: "not", predicate };
}

// ─── Query definition builders ───────────────────────────────────────────────

function computedField(
	key: string,
	expression: SavedViewExpression,
): ComputedFieldDef {
	return { key, expression };
}

function eventJoin(key: string, eventSchemaSlug: string): EventJoinDef {
	return { key, kind: "latestEvent", eventSchemaSlug };
}

function sortByExpr(
	direction: "asc" | "desc",
	expression: SavedViewExpression,
): SavedViewQueryDefinition["sort"] {
	return { direction, expression };
}

// ─── Display helpers ─────────────────────────────────────────────────────────

function propertyReference(...fields: string[]) {
	return fields;
}

function schemaField(schemaSlug: string, property: string) {
	const entityBuiltins = new Set([
		"id",
		"name",
		"image",
		"createdAt",
		"updatedAt",
		"externalId",
		"sandboxScriptId",
	]);
	if (entityBuiltins.has(property)) {
		return `entity.${schemaSlug}.${property}`;
	}

	return `entity.${schemaSlug}.properties.${property}`;
}

function cardConfig(
	imageProperty: string[] | null,
	titleProperty: string[] | null,
	badgeProperty: string[] | null,
	subtitleProperty: string[] | null,
): {
	imageProperty: string[] | null;
	titleProperty: string[] | null;
	badgeProperty: string[] | null;
	subtitleProperty: string[] | null;
} {
	return {
		imageProperty,
		titleProperty,
		badgeProperty,
		subtitleProperty,
	};
}

function tableColumn(
	label: string,
	...property: string[]
): SavedViewTableColumn {
	return { label, property };
}

function sortDefinition(
	direction: "asc" | "desc",
	...fields: string[]
): SavedViewSortInput {
	return { fields, direction };
}

function displayConfiguration(
	grid: {
		imageProperty: string[] | null;
		titleProperty: string[] | null;
		badgeProperty: string[] | null;
		subtitleProperty: string[] | null;
	},
	columns: SavedViewTableColumn[],
	list = grid,
): SavedViewDisplayConfigInput {
	return {
		grid,
		list,
		table: { columns },
	};
}

function generateWhiskey(): {
	name: string;
	properties: Record<string, unknown>;
} {
	const types = ["Bourbon", "Scotch", "Rye", "Irish", "Japanese", "Canadian"];
	const regions = [
		"Kentucky",
		"Tennessee",
		"Scotland",
		"Ireland",
		"Japan",
		"Canada",
		"Speyside",
		"Islay",
	];

	const name = `${faker.company.name()} ${randomChoice(types)}`;
	const properties = {
		age: randomInt(3, 25),
		type: randomChoice(types),
		distillery: faker.company.name(),
		region: randomChoice(regions),
		proof: faker.number.float({ min: 80, max: 140, fractionDigits: 1 }),
	};

	return { name, properties };
}

function generatePlace(): {
	name: string;
	properties: Record<string, unknown>;
} {
	const types = ["Restaurant", "Cafe", "Park", "Museum", "Gallery", "Theater"];
	const name = faker.company.name();
	const properties = {
		city: faker.location.city(),
		type: randomChoice(types),
		country: faker.location.country(),
		latitude: faker.location.latitude(),
		longitude: faker.location.longitude(),
		address: faker.location.streetAddress(),
	};

	return { name, properties };
}

function generateSmartphone(): {
	name: string;
	properties: Record<string, unknown>;
} {
	const manufacturers = [
		"Apple",
		"Samsung",
		"Google",
		"OnePlus",
		"Xiaomi",
		"Sony",
	];
	const osList = ["iOS", "Android"];
	const manufacturer = randomChoice(manufacturers);
	const model = `${manufacturer} ${faker.commerce.productName()}`;

	const properties = {
		manufacturer,
		os: randomChoice(osList),
		year: randomInt(2018, 2024),
		ram_gb: randomChoice([4, 6, 8, 12, 16]),
		storage_gb: randomChoice([64, 128, 256, 512, 1024]),
		price_usd: faker.number.float({ min: 299, max: 1599, fractionDigits: 2 }),
		screen_size: faker.number.float({ min: 5.5, max: 7.0, fractionDigits: 1 }),
	};

	return { name: model, properties };
}

function generateFeaturePhone(): {
	name: string;
	properties: Record<string, unknown>;
} {
	const manufacturers = ["Nokia", "Alcatel", "Samsung", "LG", "Motorola"];
	const manufacturer = randomChoice(manufacturers);
	const model = `${manufacturer} ${faker.commerce.productName()}`;

	const properties = {
		manufacturer,
		color: faker.color.human(),
		year: randomInt(2010, 2022),
		has_camera: faker.datatype.boolean(),
		battery_mah: randomInt(800, 2000),
	};

	return { name: model, properties };
}

function generateTablet(): {
	name: string;
	properties: Record<string, unknown>;
} {
	const osList = ["iPadOS", "Android", "Windows"];
	const manufacturers = ["Apple", "Samsung", "Microsoft", "Amazon", "Lenovo"];

	const manufacturer = randomChoice(manufacturers);
	const model = `${manufacturer} ${faker.commerce.productName()}`;

	const properties = {
		manufacturer,
		os: randomChoice(osList),
		year: randomInt(2019, 2024),
		has_cellular: faker.datatype.boolean(),
		storage_gb: randomChoice([32, 64, 128, 256, 512]),
		screen_size: faker.number.float({ min: 7.0, max: 13.0, fractionDigits: 1 }),
	};

	return { name: model, properties };
}

function generateWhiskeyTasting(): Record<string, unknown> {
	return {
		location: faker.location.city(),
		rating: randomInt(1, 10),
		notes: faker.lorem.sentences(2),
	};
}

function generateWhiskeyPurchase(): Record<string, unknown> {
	return {
		store: faker.company.name(),
		bottle_size: randomChoice([375, 750, 1000]),
		price: faker.number.float({ min: 25, max: 500, fractionDigits: 2 }),
	};
}

function generatePlaceVisit(): Record<string, unknown> {
	return {
		companions: faker.person.fullName(),
		notes: faker.lorem.sentences(1),
		date: dayjs(faker.date.past({ years: 2 })).format("YYYY-MM-DD"),
		duration_hours: faker.number.float({ min: 0.5, max: 8, fractionDigits: 1 }),
	};
}

function generatePlaceRating(): Record<string, unknown> {
	return {
		rating: randomInt(1, 5),
		would_return: faker.datatype.boolean(),
		review: faker.lorem.sentences(3),
	};
}

function generatePlacePhoto(): Record<string, unknown> {
	return {
		photo_url: faker.image.url(),
		caption: faker.lorem.sentence(),
	};
}

async function seedWhiskeys(client: APIClient) {
	console.log("\n🥃 Seeding Whiskeys Tracker...");

	const tracker = await createTracker(
		client,
		"Whiskeys",
		"whiskeys",
		"wine",
		"#D97706",
		"Track your whiskey collection and tastings",
	);

	const entitySchema = await createEntitySchema(
		client,
		"Whiskey",
		"whiskey",
		tracker.id,
		"wine",
		"#D97706",
		{
			fields: {
				distillery: {
					type: "string",
					label: "Distillery",
					validation: { required: true },
				},
				age: { type: "integer", label: "Age" },
				region: { type: "string", label: "Region" },
				proof: { type: "number", label: "Proof" },
				type: { type: "string", label: "Type" },
			},
		},
	);

	const tastingSchema = await createEventSchema(
		client,
		"Tasting",
		"tasting",
		entitySchema.id,
		{
			fields: {
				rating: {
					type: "integer",
					label: "Rating",
					validation: { required: true, maximum: 10, minimum: 1 },
				},
				notes: { type: "string", label: "Notes" },
				location: { type: "string", label: "Location" },
			},
		},
	);

	const purchaseSchema = await createEventSchema(
		client,
		"Purchase",
		"purchase",
		entitySchema.id,
		{
			fields: {
				price: {
					type: "number",
					label: "Price",
					validation: { required: true },
				},
				store: { type: "string", label: "Store" },
				bottle_size: { type: "integer", label: "Bottle Size" },
			},
		},
	);

	const entityCount = randomInt(90, 110);
	console.log(`\n  Creating ${entityCount} whiskey entities...`);

	const entities: Awaited<ReturnType<typeof createEntity>>[] = [];
	for (let i = 0; i < entityCount; i++) {
		const whiskey = generateWhiskey();
		const entity = await createEntity(
			client,
			whiskey.name,
			entitySchema.id,
			whiskey.properties,
			generateImageUrl(whiskey.name, 400, 600),
		);
		entities.push(entity);

		if ((i + 1) % 10 === 0) {
			console.log(`    Progress: ${i + 1}/${entityCount} entities created`);
		}
	}
	console.log(`  ✓ Created ${entityCount} whiskey entities`);

	console.log("\n  Creating events for whiskeys...");
	const whiskeyEvents: EventPayload[] = [];
	for (const entity of entities) {
		const eventCount = randomInt(3, 100);
		const eventSchemas = [tastingSchema, purchaseSchema];

		for (let i = 0; i < eventCount; i++) {
			const schema = randomChoice(eventSchemas);
			const properties =
				schema.id === tastingSchema.id
					? generateWhiskeyTasting()
					: generateWhiskeyPurchase();

			whiskeyEvents.push({
				properties,
				entityId: entity.id,
				eventSchemaId: schema.id,
			});
		}
	}
	await createEvents(client, whiskeyEvents);
	const totalEvents = whiskeyEvents.length;
	console.log(`  ✓ Created ${totalEvents} events for whiskeys`);

	return { tracker, entities, entityCount, eventCount: totalEvents };
}

async function seedPlaces(client: APIClient) {
	console.log("\n📍 Seeding Places Tracker...");

	const tracker = await createTracker(
		client,
		"Places",
		"places",
		"map-pin",
		"#3B82F6",
		"Track places you've visited and want to visit",
	);

	const entitySchema = await createEntitySchema(
		client,
		"Place",
		"place",
		tracker.id,
		"map-pin",
		"#3B82F6",
		{
			fields: {
				city: { type: "string", label: "City", validation: { required: true } },
				country: {
					type: "string",
					label: "Country",
					validation: { required: true },
				},
				type: { type: "string", label: "Type" },
				address: { type: "string", label: "Address" },
				latitude: { type: "number", label: "Latitude" },
				longitude: { type: "number", label: "Longitude" },
			},
		},
	);

	const visitSchema = await createEventSchema(
		client,
		"Visit",
		"visit",
		entitySchema.id,
		{
			fields: {
				date: { type: "date", label: "Date", validation: { required: true } },
				duration_hours: { type: "number", label: "Duration Hours" },
				companions: { type: "string", label: "Companions" },
				notes: { type: "string", label: "Notes" },
			},
		},
	);

	const ratingSchema = await createEventSchema(
		client,
		"Rating",
		"rating",
		entitySchema.id,
		{
			fields: {
				rating: {
					type: "integer",
					label: "Rating",
					validation: { required: true, maximum: 5, minimum: 1 },
				},
				review: { type: "string", label: "Review" },
				would_return: { type: "boolean", label: "Would Return" },
			},
		},
	);

	const photoSchema = await createEventSchema(
		client,
		"Photo",
		"photo",
		entitySchema.id,
		{
			fields: {
				photo_url: { type: "string", label: "Photo URL" },
				caption: { type: "string", label: "Caption" },
			},
		},
	);

	const entityCount = randomInt(90, 110);
	console.log(`\n  Creating ${entityCount} place entities...`);

	const entities: Awaited<ReturnType<typeof createEntity>>[] = [];
	for (let i = 0; i < entityCount; i++) {
		const place = generatePlace();
		const entity = await createEntity(
			client,
			place.name,
			entitySchema.id,
			place.properties,
			generateImageUrl(place.name, 800, 600),
		);
		entities.push(entity);

		if ((i + 1) % 10 === 0) {
			console.log(`    Progress: ${i + 1}/${entityCount} entities created`);
		}
	}
	console.log(`  ✓ Created ${entityCount} place entities`);

	console.log("\n  Creating events for places...");
	const placeEvents: EventPayload[] = [];
	for (const entity of entities) {
		const eventCount = randomInt(3, 100);
		const eventSchemas = [visitSchema, ratingSchema, photoSchema];

		for (let i = 0; i < eventCount; i++) {
			const schema = randomChoice(eventSchemas);
			let properties: Record<string, unknown>;

			if (schema.id === visitSchema.id) {
				properties = generatePlaceVisit();
			} else if (schema.id === ratingSchema.id) {
				properties = generatePlaceRating();
			} else {
				properties = generatePlacePhoto();
			}

			placeEvents.push({
				properties,
				entityId: entity.id,
				eventSchemaId: schema.id,
			});
		}
	}
	await createEvents(client, placeEvents);
	const totalEvents = placeEvents.length;
	console.log(`  ✓ Created ${totalEvents} events for places`);

	return { tracker, entities, entityCount, eventCount: totalEvents };
}

async function seedMobilePhones(client: APIClient) {
	console.log("\n📱 Seeding Mobile Phones Tracker...");

	const tracker = await createTracker(
		client,
		"Mobile Phones",
		"mobile-phones",
		"smartphone",
		"#6B7280",
		"Track your mobile device collection",
	);

	const smartphoneSchema = await createEntitySchema(
		client,
		"Smartphone",
		"smartphone",
		tracker.id,
		"smartphone",
		"#6B7280",
		{
			fields: {
				manufacturer: {
					type: "string",
					label: "Manufacturer",
					validation: { required: true },
				},
				year: { type: "integer", label: "Year" },
				os: { type: "string", label: "OS" },
				screen_size: { type: "number", label: "Screen Size" },
				storage_gb: { type: "integer", label: "Storage GB" },
				ram_gb: { type: "integer", label: "RAM GB" },
				price_usd: { type: "number", label: "Price USD" },
			},
		},
	);

	const featurePhoneSchema = await createEntitySchema(
		client,
		"Feature Phone",
		"feature-phone",
		tracker.id,
		"phone",
		"#9CA3AF",
		{
			fields: {
				manufacturer: {
					type: "string",
					label: "Manufacturer",
					validation: { required: true },
				},
				year: { type: "integer", label: "Year" },
				has_camera: { type: "boolean", label: "Has Camera" },
				battery_mah: { type: "integer", label: "Battery mAh" },
				color: { type: "string", label: "Color" },
			},
		},
	);

	const tabletSchema = await createEntitySchema(
		client,
		"Tablet",
		"tablet",
		tracker.id,
		"tablet",
		"#4B5563",
		{
			fields: {
				manufacturer: {
					type: "string",
					label: "Manufacturer",
					validation: { required: true },
				},
				year: { type: "integer", label: "Year" },
				screen_size: { type: "number", label: "Screen Size" },
				os: { type: "string", label: "OS" },
				storage_gb: { type: "integer", label: "Storage GB" },
				has_cellular: { type: "boolean", label: "Has Cellular" },
			},
		},
	);

	console.log("\n  Creating smartphone entities...");
	const smartphoneCount = randomInt(90, 110);
	const entities: SeedEntity[] = [];
	for (let i = 0; i < smartphoneCount; i++) {
		const phone = generateSmartphone();
		const entity = await createEntity(
			client,
			phone.name,
			smartphoneSchema.id,
			phone.properties,
			generateImageUrl(phone.name, 400, 600),
		);
		entities.push(entity);

		if ((i + 1) % 10 === 0) {
			console.log(
				`    Progress: ${i + 1}/${smartphoneCount} smartphones created`,
			);
		}
	}
	console.log(`  ✓ Created ${smartphoneCount} smartphones`);

	console.log("\n  Creating feature phone entities...");
	const featurePhoneCount = randomInt(90, 110);
	for (let i = 0; i < featurePhoneCount; i++) {
		const phone = generateFeaturePhone();
		const entity = await createEntity(
			client,
			phone.name,
			featurePhoneSchema.id,
			phone.properties,
			generateImageUrl(phone.name, 400, 600),
		);
		entities.push(entity);

		if ((i + 1) % 10 === 0) {
			console.log(
				`    Progress: ${i + 1}/${featurePhoneCount} feature phones created`,
			);
		}
	}
	console.log(`  ✓ Created ${featurePhoneCount} feature phones`);

	console.log("\n  Creating tablet entities...");
	const tabletCount = randomInt(90, 110);
	for (let i = 0; i < tabletCount; i++) {
		const tablet = generateTablet();
		const entity = await createEntity(
			client,
			tablet.name,
			tabletSchema.id,
			tablet.properties,
			generateImageUrl(tablet.name, 400, 600),
		);
		entities.push(entity);

		if ((i + 1) % 10 === 0) {
			console.log(`    Progress: ${i + 1}/${tabletCount} tablets created`);
		}
	}
	console.log(`  ✓ Created ${tabletCount} tablets`);

	return {
		tracker,
		entities,
		entityCount: smartphoneCount + featurePhoneCount + tabletCount,
		eventCount: 0,
	};
}

// ─── Builtin media tracker helpers ─────────────────────────────────────────

async function getBuiltinTracker(apiClient: APIClient) {
	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { data, response } = await client.GET("/trackers", {
		params: { query: { includeDisabled: "true" } },
	});

	if (!response.ok || !data?.data) {
		throw new Error("Failed to list trackers");
	}

	const builtinTracker = data.data.find((t) => t.isBuiltin);
	if (!builtinTracker) {
		throw new Error("Built-in media tracker not found");
	}

	return builtinTracker;
}

async function listMediaEntitySchemas(apiClient: APIClient, trackerId: string) {
	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { data, response } = await client.POST("/entity-schemas/list", {
		body: { trackerId },
	});

	if (!response.ok || !data?.data) {
		throw new Error("Failed to list media entity schemas");
	}

	return data.data;
}

async function getMediaLifecycleEventSchemas(
	apiClient: APIClient,
	entitySchemaId: string,
) {
	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { data, response } = await client.GET("/event-schemas", {
		params: { query: { entitySchemaId } },
	});

	if (!response.ok || !data?.data) {
		throw new Error(
			`Failed to list event schemas for entity schema ${entitySchemaId}`,
		);
	}

	const backlog = data.data.find((s) => s.slug === "backlog");
	const progress = data.data.find((s) => s.slug === "progress");
	const complete = data.data.find((s) => s.slug === "complete");
	const review = data.data.find((s) => s.slug === "review");

	if (!backlog || !progress || !complete || !review) {
		throw new Error(
			`Missing lifecycle event schemas for entity schema ${entitySchemaId}`,
		);
	}

	return { backlog, complete, progress, review };
}

// ─── Media seeding helpers ──────────────────────────────────────────────────

const MEDIA_ENTITY_SCHEMA_SLUGS = [
	"anime",
	"audiobook",
	"book",
	"comic-book",
	"manga",
	"movie",
	"music",
	"podcast",
	"show",
	"video-game",
	"visual-novel",
] as const;

type MediaEntitySchemaSlug = (typeof MEDIA_ENTITY_SCHEMA_SLUGS)[number];

const MEDIA_SEARCH_QUERIES: Record<
	MediaEntitySchemaSlug,
	{ query: string; pages: number[] }
> = {
	anime: { query: "naruto", pages: [1, 2] },
	audiobook: { query: "thinking", pages: [1, 2] },
	book: { query: "the lord", pages: [1, 2] },
	"comic-book": { query: "batman", pages: [1, 2] },
	manga: { query: "one piece", pages: [1, 2] },
	movie: { query: "star", pages: [1, 2] },
	music: { query: "rock", pages: [1, 2] },
	podcast: { query: "daily", pages: [1, 2] },
	show: { query: "breaking", pages: [1, 2] },
	"video-game": { query: "zelda", pages: [1, 2] },
	"visual-novel": { query: "fate", pages: [1, 2] },
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollSearchJob(
	apiClient: APIClient,
	jobId: string,
): Promise<Array<{ externalId: string }>> {
	const client = apiClient.getClient();
	const startedAt = Date.now();
	while (true) {
		apiClient.incrementRequestCount();
		const { data, response } = await client.GET(
			"/entity-schemas/search/{jobId}",
			{ params: { path: { jobId } } },
		);
		if (!response.ok || !data?.data) {
			throw new Error(`Failed to poll search job ${jobId}`);
		}
		if (data.data.status === "pending") {
			if (Date.now() - startedAt > 60000) {
				throw new Error(`Search job ${jobId} timed out`);
			}
			await sleep(500);
			continue;
		}
		if (data.data.status === "failed") {
			throw new Error(`Search job failed: ${data.data.error}`);
		}
		const value = (data.data as { status: "completed"; value: unknown })
			.value as { items?: Array<{ externalId: string }> };
		return value?.items ?? [];
	}
}

async function searchMediaPage(
	apiClient: APIClient,
	scriptId: string,
	query: string,
	page: number,
): Promise<Array<{ externalId: string }>> {
	const client = apiClient.getClient();
	apiClient.incrementRequestCount();
	const { data, response } = await client.POST("/entity-schemas/search", {
		body: { scriptId, context: { query, page, pageSize: 10 } },
	});
	if (!response.ok || !data?.data) {
		throw new Error(`Failed to enqueue search for "${query}" page ${page}`);
	}
	return pollSearchJob(apiClient, data.data.jobId);
}

async function importMediaEntity(
	apiClient: APIClient,
	scriptId: string,
	externalId: string,
	entitySchemaId: string,
): Promise<SeedEntity | null> {
	const client = apiClient.getClient();
	apiClient.incrementRequestCount();
	const { data: importData, response: importResp } = await client.POST(
		"/entity-schemas/import",
		{ body: { scriptId, externalId, entitySchemaId } },
	);
	if (!importResp.ok || !importData?.data) {
		return null;
	}
	const jobId = importData.data.jobId;
	const startedAt = Date.now();
	while (true) {
		apiClient.incrementRequestCount();
		const { data: pollData, response: pollResp } = await client.GET(
			"/entity-schemas/import/{jobId}",
			{ params: { path: { jobId } } },
		);
		if (!pollResp.ok || !pollData?.data) {
			return null;
		}
		const status = pollData.data.status;
		if (status === "pending") {
			if (Date.now() - startedAt > 60000) {
				return null;
			}
			await sleep(500);
			continue;
		}
		if (status === "failed") {
			return null;
		}
		return (pollData.data as { status: "completed"; data: SeedEntity }).data;
	}
}

// ─── Episodic progress helpers ───────────────────────────────────────────────

const EPISODIC_MEDIA_SLUGS = new Set<MediaEntitySchemaSlug>([
	"show",
	"anime",
	"manga",
	"podcast",
]);

function generateEpisodicProgressFields(
	slug: MediaEntitySchemaSlug,
): Record<string, unknown> {
	if (slug === "show") {
		return { showSeason: randomInt(1, 3), showEpisode: randomInt(1, 20) };
	}
	if (slug === "anime") {
		return { animeEpisode: randomInt(1, 500) };
	}
	if (slug === "manga") {
		const fields: Record<string, unknown> = {
			mangaChapter: faker.number.float({ min: 1, max: 300, fractionDigits: 0 }),
		};
		if (faker.datatype.boolean()) {
			fields.mangaVolume = randomInt(1, 30);
		}
		return fields;
	}
	if (slug === "podcast") {
		return { podcastEpisode: randomInt(1, 200) };
	}
	return {};
}

// ─── Media seeding ──────────────────────────────────────────────────────────

async function seedMedia(client: APIClient) {
	console.log("\n🎬 Seeding Media Tracker...");

	const builtinTracker = await getBuiltinTracker(client);
	console.log(
		`  Found builtin tracker: ${builtinTracker.name} (${builtinTracker.id})`,
	);

	const allSchemas = await listMediaEntitySchemas(client, builtinTracker.id);
	const schemas = allSchemas.filter((s) =>
		(MEDIA_ENTITY_SCHEMA_SLUGS as readonly string[]).includes(s.slug),
	);
	console.log(
		`  Found ${schemas.length} media entity schemas to seed (of ${allSchemas.length} total)`,
	);

	let totalEntities = 0;
	let totalEvents = 0;
	const allEntities: SeedEntity[] = [];

	type MediaEventSchemas = Awaited<
		ReturnType<typeof getMediaLifecycleEventSchemas>
	>;
	type WorkItem = {
		externalId: string;
		scriptId: string;
		schema: (typeof schemas)[number];
		eventSchemas: MediaEventSchemas;
	};

	// Phase 1: search all schemas (all providers) and collect work items
	const workItems: WorkItem[] = [];
	for (const schema of schemas) {
		const slug = schema.slug as MediaEntitySchemaSlug;
		console.log(`\n  Searching: ${schema.name} (${slug})...`);
		const eventSchemas = await getMediaLifecycleEventSchemas(client, schema.id);

		if (!schema.providers.length) {
			console.log("    No provider available, skipping");
			continue;
		}

		const searchConfig = MEDIA_SEARCH_QUERIES[slug];
		for (const provider of schema.providers) {
			const scriptId = provider.scriptId;
			console.log(`    Provider: ${provider.name}...`);
			const identifiers: string[] = [];
			for (const page of searchConfig.pages) {
				try {
					const items = await searchMediaPage(
						client,
						scriptId,
						searchConfig.query,
						page,
					);
					for (const item of items) {
						if (!identifiers.includes(item.externalId)) {
							identifiers.push(item.externalId);
						}
					}
					console.log(
						`      Search "${searchConfig.query}" page ${page}: ${items.length} results`,
					);
				} catch (err) {
					console.log(`      Search page ${page} failed: ${err}`);
				}
			}
			console.log(
				`    Collected ${identifiers.length} unique identifiers from ${provider.name}`,
			);

			for (const externalId of identifiers) {
				workItems.push({ externalId, scriptId, schema, eventSchemas });
			}
		}
	}

	// Phase 2: shuffle work items so entity types are interleaved
	for (let i = workItems.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const temp = workItems[i];
		workItems[i] = workItems[j] as WorkItem;
		workItems[j] = temp as WorkItem;
	}
	console.log(
		`\n  Importing ${workItems.length} entities (shuffled across all types)...`,
	);

	// Phase 3: import in shuffled order, group results by schema id
	const entitiesBySchemaId = new Map<string, SeedEntity[]>();
	const eventSchemasBySchemaId = new Map<string, MediaEventSchemas>();

	for (const [index, item] of workItems.entries()) {
		const entity = await importMediaEntity(
			client,
			item.scriptId,
			item.externalId,
			item.schema.id,
		);
		if (entity) {
			const list = entitiesBySchemaId.get(item.schema.id) ?? [];
			list.push(entity);
			entitiesBySchemaId.set(item.schema.id, list);
			eventSchemasBySchemaId.set(item.schema.id, item.eventSchemas);
			allEntities.push(entity);
		}
		if ((index + 1) % 20 === 0) {
			console.log(`    Progress: ${index + 1}/${workItems.length} imported`);
		}
	}
	console.log(`  Imported ${allEntities.length} entities total`);

	// Phase 4: create lifecycle events per schema group
	const completionVariants: Array<() => Record<string, unknown>> = [
		() => ({ completionMode: "just_now" }),
		() => ({ completionMode: "unknown" }),
		() => ({
			completionMode: "custom_timestamps",
			completedOn: dayjs().subtract(randomInt(1, 365), "day").toISOString(),
		}),
		() => ({
			completionMode: "custom_timestamps",
			startedOn: dayjs().subtract(randomInt(400, 730), "day").toISOString(),
			completedOn: dayjs().subtract(randomInt(1, 365), "day").toISOString(),
		}),
	];

	for (const schema of schemas) {
		const entities = entitiesBySchemaId.get(schema.id);
		const eventSchemas = eventSchemasBySchemaId.get(schema.id);
		if (!entities?.length || !eventSchemas) {
			continue;
		}

		// ~28% backlog (up-next), ~20% in-progress (continue),
		// ~24% completed unrated (rate-these), ~28% completed + reviewed
		const entityCount = entities.length;
		const backlogCount = Math.ceil(entityCount * 0.28);
		const progressCount = Math.ceil(entityCount * 0.2);
		const completeNoReviewCount = Math.ceil(entityCount * 0.24);

		const backlogEntities = entities.slice(0, backlogCount);
		const progressEntities = entities.slice(
			backlogCount,
			backlogCount + progressCount,
		);
		const completeNoReviewEntities = entities.slice(
			backlogCount + progressCount,
			backlogCount + progressCount + completeNoReviewCount,
		);
		const completeWithReviewEntities = entities.slice(
			backlogCount + progressCount + completeNoReviewCount,
		);

		const mediaEvents: EventPayload[] = [];

		for (const entity of backlogEntities) {
			mediaEvents.push({
				properties: {},
				entityId: entity.id,
				eventSchemaId: eventSchemas.backlog.id,
			});
		}

		for (const entity of progressEntities) {
			const slug = schema.slug as MediaEntitySchemaSlug;
			const episodicFields = EPISODIC_MEDIA_SLUGS.has(slug)
				? generateEpisodicProgressFields(slug)
				: {};
			mediaEvents.push({
				entityId: entity.id,
				eventSchemaId: eventSchemas.progress.id,
				properties: { progressPercent: randomInt(10, 85), ...episodicFields },
			});
		}

		for (const entity of completeNoReviewEntities) {
			mediaEvents.push({
				entityId: entity.id,
				eventSchemaId: eventSchemas.complete.id,
				properties: randomChoice(completionVariants)(),
			});
		}

		for (const entity of completeWithReviewEntities) {
			mediaEvents.push({
				entityId: entity.id,
				eventSchemaId: eventSchemas.complete.id,
				properties: randomChoice(completionVariants)(),
			});
			mediaEvents.push({
				entityId: entity.id,
				eventSchemaId: eventSchemas.review.id,
				properties: {
					rating: randomInt(1, 5),
					...(faker.datatype.boolean()
						? { review: faker.lorem.sentences(randomInt(1, 3)) }
						: {}),
				},
			});
		}

		await createEvents(client, mediaEvents);
		console.log(
			`    ${schema.name}: ${entities.length} entities, ${mediaEvents.length} events`,
		);

		totalEntities += entities.length;
		totalEvents += mediaEvents.length;
	}

	console.log(
		`\n  ✓ Media seeding complete: ${totalEntities} entities, ${totalEvents} events`,
	);

	return {
		tracker: builtinTracker,
		entities: allEntities,
		entityCount: totalEntities,
		eventCount: totalEvents,
	};
}

async function seedCollections(
	client: APIClient,
	input: {
		phones: SeedEntity[];
		places: SeedEntity[];
		whiskeys: SeedEntity[];
	},
) {
	console.log("\n🗂️ Seeding Collections...");

	const recommendedPours = await createCollection(client, {
		name: "Recommended Pours",
		description: "Whiskeys friends keep insisting deserve another pour",
		membershipPropertiesSchema: {
			fields: {
				tags: {
					type: "array" as const,
					label: "Tags",
					items: { type: "string" as const, label: "Tag" },
				},
				notes: { type: "string" as const, label: "Notes" },
				rating: { type: "integer" as const, label: "Rating" },
				context: {
					type: "object" as const,
					label: "Context",
					unknownKeys: "passthrough" as const,
					properties: {
						mood: { type: "string" as const, label: "Mood" },
						venue: { type: "string" as const, label: "Venue" },
					},
				},
				recommendedBy: { type: "string" as const, label: "Recommended By" },
			},
		},
	} as unknown as CreateCollectionBody);

	const weekendEscapes = await createCollection(client, {
		name: "Weekend Escapes",
		description: "Places worth a short trip or a spontaneous Saturday",
		membershipPropertiesSchema: {
			fields: {
				notes: { type: "string" as const, label: "Notes" },
				priority: { type: "integer" as const, label: "Priority" },
				idealSeason: { type: "string" as const, label: "Ideal Season" },
				visitWindow: { type: "string" as const, label: "Visit Window" },
			},
		},
	});

	const pocketFavorites = await createCollection(client, {
		name: "Pocket Favorites",
		description: "Phones and tablets that feel great to keep around",
		membershipPropertiesSchema: {
			fields: {
				notes: { type: "string" as const, label: "Notes" },
				status: { type: "string" as const, label: "Status" },
				carryScore: { type: "integer" as const, label: "Carry Score" },
			},
		},
	});

	const allStarPicks = await createCollection(client, {
		name: "All-Star Picks",
		description: "Cross-tracker highlights pulled together with ad-hoc notes",
	});

	const collectionGuide = await createCollection(client, {
		name: "Collection Guide",
		description:
			"A collection of collections for browsing the seeded demo shelves",
		membershipPropertiesSchema: {
			fields: {
				blurb: { type: "string" as const, label: "Blurb" },
				section: { type: "string" as const, label: "Section" },
				priority: { type: "integer" as const, label: "Priority" },
			},
		},
	});

	let membershipCount = 0;
	let nestedCollectionMembershipCount = 0;

	console.log("  Adding whiskey memberships...");
	for (const whiskey of faker.helpers.arrayElements(input.whiskeys, 10)) {
		await addEntityToCollection(client, {
			entityId: whiskey.id,
			collectionId: recommendedPours.id,
			properties: {
				tags: faker.helpers.arrayElements(
					["peaty", "starter", "gift", "special-occasion", "dessert"],
					randomInt(1, 3),
				),
				notes: faker.lorem.sentence(),
				rating: randomInt(6, 10),
				context: {
					mood: randomChoice(["quiet-night", "celebration", "tasting-flight"]),
					venue: faker.location.city(),
					shelf: randomChoice(["top", "middle", "shared"]),
				},
				recommendedBy: faker.person.firstName(),
			},
		});
		membershipCount++;
	}

	console.log("  Adding place memberships...");
	for (const [index, place] of faker.helpers
		.arrayElements(input.places, 10)
		.entries()) {
		await addEntityToCollection(client, {
			entityId: place.id,
			collectionId: weekendEscapes.id,
			properties: {
				notes: faker.lorem.sentence(),
				priority: index + 1,
				idealSeason: randomChoice(["spring", "summer", "autumn", "winter"]),
				visitWindow: randomChoice(["morning", "afternoon", "evening"]),
			},
		});
		membershipCount++;
	}

	console.log("  Adding phone memberships...");
	for (const phone of faker.helpers.arrayElements(input.phones, 12)) {
		await addEntityToCollection(client, {
			entityId: phone.id,
			collectionId: pocketFavorites.id,
			properties: {
				notes: faker.lorem.sentence(),
				status: randomChoice(["daily", "display", "backup"]),
				carryScore: randomInt(6, 10),
			},
		});
		membershipCount++;
	}

	console.log("  Adding cross-tracker memberships...");
	const showcaseMembers = [
		...faker.helpers.arrayElements(input.whiskeys, 3),
		...faker.helpers.arrayElements(input.places, 3),
		...faker.helpers.arrayElements(input.phones, 3),
	];
	for (const [index, entity] of showcaseMembers.entries()) {
		await addEntityToCollection(client, {
			entityId: entity.id,
			collectionId: allStarPicks.id,
			properties: {
				lane: randomChoice(["featured", "deep-cut", "starter-pack"]),
				pickedAt: dayjs(faker.date.recent({ days: 90 })).format("YYYY-MM-DD"),
				priority: index + 1,
				featuredBecause: faker.lorem.sentence(),
			},
		});
		membershipCount++;
	}

	console.log("  Nesting collections inside a guide collection...");
	const nestedCollections = [
		{
			blurb: "A sampler of socially-endorsed pours",
			entityId: recommendedPours.id,
			section: "Whiskey Highlights",
		},
		{
			blurb: "Short-trip ideas with clear visit priorities",
			entityId: weekendEscapes.id,
			section: "Place Shortlist",
		},
		{
			blurb: "Portable devices worth revisiting",
			entityId: pocketFavorites.id,
			section: "Device Rotation",
		},
		{
			blurb: "Cross-category picks with flexible metadata",
			entityId: allStarPicks.id,
			section: "Showcase Shelf",
		},
	];
	for (const [index, nestedCollection] of nestedCollections.entries()) {
		await addEntityToCollection(client, {
			entityId: nestedCollection.entityId,
			collectionId: collectionGuide.id,
			properties: {
				blurb: nestedCollection.blurb,
				section: nestedCollection.section,
				priority: index + 1,
			},
		});
		membershipCount++;
		nestedCollectionMembershipCount++;
	}

	console.log(
		`  ✓ Created 5 collections and ${membershipCount} memberships (${nestedCollectionMembershipCount} nested collections)`,
	);

	return {
		collectionCount: 5,
		membershipCount,
		nestedCollectionMembershipCount,
	};
}

async function seedSavedViews(
	client: APIClient,
	whiskeyTrackerId: string,
	placesTrackerId: string,
	phonesTrackerId: string,
) {
	console.log("\n💾 Seeding Saved Views...");

	const savedViews: Awaited<ReturnType<typeof createSavedView>>[] = [];
	const defaultCard = cardConfig(
		propertyReference("@image"),
		propertyReference("@name"),
		null,
		null,
	);
	const allSchemaSlugs = [
		"whiskey",
		"place",
		"smartphone",
		"feature-phone",
		"tablet",
	];

	const whiskeyViews: SavedViewSpec[] = [
		{
			trackerId: whiskeyTrackerId,
			name: "Premium Aged Whiskeys",
			icon: "wine",
			accentColor: "#D97706",
			queryDefinition: {
				filters: [
					{ op: "gte", field: schemaField("whiskey", "age"), value: 18 },
				],
				entitySchemaSlugs: ["whiskey"],
				sort: sortDefinition("desc", schemaField("whiskey", "age")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "age")),
					propertyReference(schemaField("whiskey", "distillery")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Age", schemaField("whiskey", "age")),
					tableColumn("Distillery", schemaField("whiskey", "distillery")),
					tableColumn("Proof", schemaField("whiskey", "proof")),
				],
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "Scotch Whiskeys",
			icon: "wine",
			accentColor: "#B45309",
			queryDefinition: {
				filters: [
					{ op: "eq", field: schemaField("whiskey", "type"), value: "Scotch" },
				],
				entitySchemaSlugs: ["whiskey"],
				sort: sortDefinition("asc", "@name"),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Region", schemaField("whiskey", "region")),
					tableColumn("Distillery", schemaField("whiskey", "distillery")),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "type")),
					propertyReference(schemaField("whiskey", "region")),
				),
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "High Proof Whiskeys",
			icon: "flame",
			accentColor: "#DC2626",
			queryDefinition: {
				filters: [
					{ op: "gte", field: schemaField("whiskey", "proof"), value: 100 },
				],
				entitySchemaSlugs: ["whiskey"],
				sort: sortDefinition("desc", schemaField("whiskey", "proof")),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Proof", schemaField("whiskey", "proof")),
					tableColumn("Type", schemaField("whiskey", "type")),
					tableColumn("Age", schemaField("whiskey", "age")),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "proof")),
					propertyReference(schemaField("whiskey", "type")),
				),
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "Recent Whiskey Additions",
			icon: "clock",
			accentColor: "#F59E0B",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["whiskey"],
				sort: sortDefinition("desc", "@createdAt"),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "type")),
					propertyReference(schemaField("whiskey", "distillery")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Created", "@createdAt"),
					tableColumn("Type", schemaField("whiskey", "type")),
				],
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "Japanese Whiskeys",
			icon: "wine",
			accentColor: "#DC2626",
			queryDefinition: {
				filters: [
					{
						op: "eq",
						field: schemaField("whiskey", "type"),
						value: "Japanese",
					},
				],
				entitySchemaSlugs: ["whiskey"],
				sort: sortDefinition("desc", schemaField("whiskey", "age")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "age")),
					propertyReference(schemaField("whiskey", "distillery")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Age", schemaField("whiskey", "age")),
					tableColumn("Distillery", schemaField("whiskey", "distillery")),
				],
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "Whiskey Regions Atlas",
			icon: "map",
			accentColor: "#7C3AED",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["whiskey"],
				sort: sortDefinition(
					"asc",
					schemaField("whiskey", "region"),
					schemaField("whiskey", "distillery"),
				),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "region")),
					propertyReference(schemaField("whiskey", "distillery")),
				),
				[
					tableColumn("Region", schemaField("whiskey", "region")),
					tableColumn("Distillery", schemaField("whiskey", "distillery")),
					tableColumn("Name", "@name"),
					tableColumn("Type", schemaField("whiskey", "type")),
					tableColumn("Proof", schemaField("whiskey", "proof")),
				],
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "Cask Strength Candidates",
			icon: "flame",
			accentColor: "#991B1B",
			queryDefinition: {
				filters: [
					{ op: "gte", field: schemaField("whiskey", "proof"), value: 120 },
				],
				entitySchemaSlugs: ["whiskey"],
				sort: sortDefinition(
					"desc",
					schemaField("whiskey", "proof"),
					schemaField("whiskey", "age"),
				),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "proof")),
					propertyReference(schemaField("whiskey", "region")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Proof", schemaField("whiskey", "proof")),
					tableColumn("Region", schemaField("whiskey", "region")),
					tableColumn("Created", "@createdAt"),
				],
			),
		},
	];

	const placeViews: SavedViewSpec[] = [
		{
			trackerId: placesTrackerId,
			name: "Restaurants & Cafes",
			icon: "utensils",
			accentColor: "#EF4444",
			queryDefinition: {
				filters: [
					{
						op: "in",
						field: schemaField("place", "type"),
						value: ["Restaurant", "Cafe"],
					},
				],
				entitySchemaSlugs: ["place"],
				sort: sortDefinition("asc", "@name"),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Type", schemaField("place", "type")),
					tableColumn("City", schemaField("place", "city")),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("place", "type")),
					propertyReference(schemaField("place", "city")),
				),
			),
		},
		{
			trackerId: placesTrackerId,
			name: "Cultural Venues",
			icon: "landmark",
			accentColor: "#8B5CF6",
			queryDefinition: {
				filters: [
					{
						op: "in",
						field: schemaField("place", "type"),
						value: ["Museum", "Gallery", "Theater"],
					},
				],
				entitySchemaSlugs: ["place"],
				sort: sortDefinition("asc", schemaField("place", "city")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("place", "type")),
					propertyReference(schemaField("place", "country")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Type", schemaField("place", "type")),
					tableColumn("City", schemaField("place", "city")),
					tableColumn("Country", schemaField("place", "country")),
				],
			),
		},
		{
			trackerId: placesTrackerId,
			name: "Parks & Outdoor Spaces",
			icon: "tree",
			accentColor: "#10B981",
			queryDefinition: {
				filters: [
					{ op: "eq", field: schemaField("place", "type"), value: "Park" },
				],
				entitySchemaSlugs: ["place"],
				sort: sortDefinition("asc", "@name"),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("place", "city")),
					propertyReference(schemaField("place", "country")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("City", schemaField("place", "city")),
					tableColumn("Address", schemaField("place", "address")),
				],
			),
		},
		{
			trackerId: placesTrackerId,
			name: "Recently Added Places",
			icon: "clock",
			accentColor: "#3B82F6",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["place"],
				sort: sortDefinition("desc", "@createdAt"),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Created", "@createdAt"),
					tableColumn("Type", schemaField("place", "type")),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("place", "type")),
					propertyReference(schemaField("place", "city")),
				),
			),
		},
		{
			trackerId: placesTrackerId,
			name: "Places by Country",
			icon: "globe",
			accentColor: "#06B6D4",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["place"],
				sort: sortDefinition(
					"asc",
					schemaField("place", "country"),
					schemaField("place", "city"),
				),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("Country", schemaField("place", "country")),
					tableColumn("City", schemaField("place", "city")),
					tableColumn("Name", "@name"),
					tableColumn("Type", schemaField("place", "type")),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("place", "country")),
					propertyReference(schemaField("place", "city")),
				),
			),
		},
		{
			trackerId: placesTrackerId,
			name: "Mapped Places",
			icon: "map-pin",
			accentColor: "#0F766E",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["place"],
				sort: sortDefinition("asc", schemaField("place", "country"), "@name"),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("place", "city")),
					propertyReference(schemaField("place", "address")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Latitude", schemaField("place", "latitude")),
					tableColumn("Longitude", schemaField("place", "longitude")),
					tableColumn("Address", schemaField("place", "address")),
				],
			),
		},
		{
			trackerId: placesTrackerId,
			name: "City Address Book",
			icon: "book-open",
			accentColor: "#1D4ED8",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["place"],
				sort: sortDefinition(
					"asc",
					schemaField("place", "city"),
					schemaField("place", "address"),
				),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("City", schemaField("place", "city")),
					tableColumn("Name", "@name"),
					tableColumn("Address", schemaField("place", "address")),
					tableColumn("Country", schemaField("place", "country")),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("place", "country")),
					propertyReference(schemaField("place", "address")),
				),
			),
		},
	];

	const phoneViews: SavedViewSpec[] = [
		{
			trackerId: phonesTrackerId,
			name: "Modern Smartphones",
			icon: "smartphone",
			accentColor: "#6366F1",
			queryDefinition: {
				filters: [
					{ op: "gte", field: schemaField("smartphone", "year"), value: 2020 },
				],
				entitySchemaSlugs: ["smartphone"],
				sort: sortDefinition("desc", schemaField("smartphone", "year")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("smartphone", "year")),
					propertyReference(schemaField("smartphone", "manufacturer")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn(
						"Manufacturer",
						schemaField("smartphone", "manufacturer"),
					),
					tableColumn("Year", schemaField("smartphone", "year")),
					tableColumn("OS", schemaField("smartphone", "os")),
				],
			),
		},
		{
			trackerId: phonesTrackerId,
			name: "High Storage Devices",
			icon: "hard-drive",
			accentColor: "#EC4899",
			queryDefinition: {
				filters: [
					{ op: "gte", field: "smartphone.storage_gb", value: 256 },
					{ op: "gte", field: "tablet.storage_gb", value: 256 },
				],
				entitySchemaSlugs: ["smartphone", "tablet"],
				sort: sortDefinition(
					"desc",
					"smartphone.storage_gb",
					"tablet.storage_gb",
				),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Storage", "smartphone.storage_gb", "tablet.storage_gb"),
					tableColumn(
						"Manufacturer",
						"smartphone.manufacturer",
						"tablet.manufacturer",
					),
					tableColumn("Year", "smartphone.year", "tablet.year"),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("smartphone.storage_gb", "tablet.storage_gb"),
					propertyReference("smartphone.manufacturer", "tablet.manufacturer"),
				),
			),
		},
		{
			trackerId: phonesTrackerId,
			name: "Apple Ecosystem Devices",
			icon: "apple",
			accentColor: "#6B7280",
			queryDefinition: {
				filters: [
					{ op: "eq", field: "smartphone.os", value: "iOS" },
					{ op: "eq", field: "tablet.os", value: "iPadOS" },
				],
				entitySchemaSlugs: ["smartphone", "tablet"],
				sort: sortDefinition("desc", "smartphone.year", "tablet.year"),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Platform", "smartphone.os", "tablet.os"),
					tableColumn("Year", "smartphone.year", "tablet.year"),
					tableColumn("Storage", "smartphone.storage_gb", "tablet.storage_gb"),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("smartphone.os", "tablet.os"),
					propertyReference("smartphone.year", "tablet.year"),
				),
			),
		},
		{
			trackerId: phonesTrackerId,
			name: "Android Devices",
			icon: "android",
			accentColor: "#22C55E",
			queryDefinition: {
				filters: [
					{ op: "eq", field: "smartphone.os", value: "Android" },
					{ op: "eq", field: "tablet.os", value: "Android" },
				],
				entitySchemaSlugs: ["smartphone", "tablet"],
				sort: sortDefinition("asc", "@name"),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("smartphone.manufacturer", "tablet.manufacturer"),
					propertyReference("smartphone.year", "tablet.year"),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn(
						"Manufacturer",
						"smartphone.manufacturer",
						"tablet.manufacturer",
					),
					tableColumn("Year", "smartphone.year", "tablet.year"),
					tableColumn("Platform", "smartphone.os", "tablet.os"),
				],
			),
		},
		{
			trackerId: phonesTrackerId,
			name: "Premium Smartphones",
			icon: "gem",
			accentColor: "#A855F7",
			queryDefinition: {
				filters: [
					{
						op: "gte",
						field: schemaField("smartphone", "price_usd"),
						value: 999,
					},
				],
				entitySchemaSlugs: ["smartphone"],
				sort: sortDefinition("desc", schemaField("smartphone", "price_usd")),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Price", schemaField("smartphone", "price_usd")),
					tableColumn(
						"Manufacturer",
						schemaField("smartphone", "manufacturer"),
					),
					tableColumn("Storage", schemaField("smartphone", "storage_gb")),
					tableColumn("RAM", schemaField("smartphone", "ram_gb")),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("smartphone", "price_usd")),
					propertyReference(schemaField("smartphone", "manufacturer")),
				),
			),
		},
		{
			trackerId: phonesTrackerId,
			name: "Budget-Friendly Phones",
			icon: "dollar-sign",
			accentColor: "#10B981",
			queryDefinition: {
				filters: [
					{
						op: "lte",
						field: schemaField("smartphone", "price_usd"),
						value: 399,
					},
				],
				entitySchemaSlugs: ["smartphone"],
				sort: sortDefinition("asc", schemaField("smartphone", "price_usd")),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Price", schemaField("smartphone", "price_usd")),
					tableColumn(
						"Manufacturer",
						schemaField("smartphone", "manufacturer"),
					),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("smartphone", "price_usd")),
					propertyReference(schemaField("smartphone", "manufacturer")),
				),
			),
		},
		{
			trackerId: phonesTrackerId,
			name: "Large Screen Devices",
			icon: "smartphone",
			accentColor: "#F97316",
			queryDefinition: {
				filters: [
					{ op: "gte", field: "smartphone.screen_size", value: 6.5 },
					{ op: "gte", field: "tablet.screen_size", value: 11 },
				],
				entitySchemaSlugs: ["smartphone", "tablet"],
				sort: sortDefinition(
					"desc",
					"smartphone.screen_size",
					"tablet.screen_size",
				),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("smartphone.screen_size", "tablet.screen_size"),
					propertyReference("smartphone.os", "tablet.os"),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn(
						"Screen Size",
						"smartphone.screen_size",
						"tablet.screen_size",
					),
					tableColumn("Platform", "smartphone.os", "tablet.os"),
					tableColumn("Storage", "smartphone.storage_gb", "tablet.storage_gb"),
				],
			),
		},
		{
			trackerId: phonesTrackerId,
			name: "Tablets with Cellular",
			icon: "signal",
			accentColor: "#EA580C",
			queryDefinition: {
				filters: [
					{
						op: "eq",
						field: schemaField("tablet", "has_cellular"),
						value: true,
					},
				],
				entitySchemaSlugs: ["tablet"],
				sort: sortDefinition("desc", schemaField("tablet", "screen_size")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("tablet", "screen_size")),
					propertyReference(schemaField("tablet", "manufacturer")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Screen Size", schemaField("tablet", "screen_size")),
					tableColumn("Manufacturer", schemaField("tablet", "manufacturer")),
					tableColumn("Storage", schemaField("tablet", "storage_gb")),
				],
			),
		},
		{
			trackerId: phonesTrackerId,
			name: "Feature Phones with Camera",
			icon: "camera",
			accentColor: "#84CC16",
			queryDefinition: {
				filters: [
					{
						op: "eq",
						field: schemaField("feature-phone", "has_camera"),
						value: true,
					},
				],
				entitySchemaSlugs: ["feature-phone"],
				sort: sortDefinition("desc", schemaField("feature-phone", "year")),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn(
						"Manufacturer",
						schemaField("feature-phone", "manufacturer"),
					),
					tableColumn("Year", schemaField("feature-phone", "year")),
					tableColumn("Battery", schemaField("feature-phone", "battery_mah")),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("feature-phone", "year")),
					propertyReference(schemaField("feature-phone", "manufacturer")),
				),
			),
		},
		{
			trackerId: phonesTrackerId,
			name: "All Mobile Devices",
			icon: "tablet",
			accentColor: "#475569",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: ["smartphone", "feature-phone", "tablet"],
				sort: sortDefinition("asc", "@name"),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(
						"smartphone.os",
						"feature-phone.color",
						"tablet.os",
					),
					propertyReference(
						"smartphone.manufacturer",
						"feature-phone.manufacturer",
						"tablet.manufacturer",
					),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn(
						"Primary Field",
						"smartphone.os",
						"feature-phone.color",
						"tablet.os",
					),
					tableColumn(
						"Manufacturer",
						"smartphone.manufacturer",
						"feature-phone.manufacturer",
						"tablet.manufacturer",
					),
					tableColumn(
						"Year",
						"smartphone.year",
						"feature-phone.year",
						"tablet.year",
					),
				],
			),
		},
	];

	const crossTrackerViews: SavedViewSpec[] = [
		{
			name: "Everything Recently Added",
			icon: "star",
			accentColor: "#FFD700",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: allSchemaSlugs,
				sort: sortDefinition("desc", "@createdAt"),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Created", "@createdAt"),
					tableColumn(
						"Primary Field",
						"whiskey.type",
						"place.type",
						"smartphone.os",
						"feature-phone.color",
						"tablet.os",
					),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(
						"whiskey.type",
						"place.type",
						"smartphone.os",
						"feature-phone.color",
						"tablet.os",
					),
					propertyReference(
						"whiskey.distillery",
						"place.city",
						"smartphone.manufacturer",
						"feature-phone.manufacturer",
						"tablet.manufacturer",
					),
				),
			),
		},
		{
			name: "All Items A-Z",
			icon: "book",
			accentColor: "#1F2937",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: allSchemaSlugs,
				sort: sortDefinition("asc", "@name"),
			},
			displayConfiguration: displayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn(
						"Context",
						"whiskey.distillery",
						"place.city",
						"smartphone.manufacturer",
						"feature-phone.manufacturer",
						"tablet.manufacturer",
					),
				],
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(
						"whiskey.type",
						"place.type",
						"smartphone.os",
						"feature-phone.color",
						"tablet.os",
					),
					propertyReference(
						"whiskey.region",
						"place.country",
						"smartphone.manufacturer",
						"feature-phone.manufacturer",
						"tablet.manufacturer",
					),
				),
			),
		},
		{
			name: "Collection Showcase",
			icon: "image",
			accentColor: "#0F172A",
			queryDefinition: {
				filters: [],
				entitySchemaSlugs: allSchemaSlugs,
				sort: sortDefinition("desc", "@updatedAt"),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(
						"whiskey.type",
						"place.type",
						"smartphone.os",
						"feature-phone.color",
						"tablet.os",
					),
					propertyReference(
						"whiskey.distillery",
						"place.address",
						"smartphone.manufacturer",
						"feature-phone.manufacturer",
						"tablet.manufacturer",
					),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn(
						"Highlight",
						"whiskey.type",
						"place.type",
						"smartphone.os",
						"feature-phone.color",
						"tablet.os",
					),
					tableColumn("Updated", "@updatedAt"),
				],
			),
		},
	];

	// ── Demo views: exercises every query-engine capability ─────────────────
	const demoViews: SavedViewSpec[] = [
		// ── Event joins ────────────────────────────────────────────────────────
		{
			trackerId: whiskeyTrackerId,
			name: "Demo: Whiskeys – Latest Tasting",
			icon: "star",
			accentColor: "#F59E0B",
			queryDefinition: {
				entitySchemaSlugs: ["whiskey"],
				eventJoins: [eventJoin("tasting", "tasting")],
				sort: sortByExpr("desc", eventCol("tasting", "createdAt")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("event.tasting.properties.rating"),
					propertyReference(schemaField("whiskey", "distillery")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Rating", "event.tasting.properties.rating"),
					tableColumn("Notes", "event.tasting.properties.notes"),
					tableColumn("Location", "event.tasting.properties.location"),
					tableColumn("Tasted At", "event.tasting.createdAt"),
				],
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "Demo: Whiskeys – Highly Rated",
			icon: "trophy",
			accentColor: "#D97706",
			queryDefinition: {
				entitySchemaSlugs: ["whiskey"],
				eventJoins: [eventJoin("tasting", "tasting")],
				filter: compare("gte", eventProp("tasting", "rating"), literal(8)),
				sort: sortByExpr("desc", eventProp("tasting", "rating")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("event.tasting.properties.rating"),
					propertyReference(schemaField("whiskey", "type")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Rating", "event.tasting.properties.rating"),
					tableColumn("Type", schemaField("whiskey", "type")),
					tableColumn("Distillery", schemaField("whiskey", "distillery")),
					tableColumn("Age", schemaField("whiskey", "age")),
				],
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "Demo: Whiskeys – Latest Purchase",
			icon: "shopping-cart",
			accentColor: "#059669",
			queryDefinition: {
				entitySchemaSlugs: ["whiskey"],
				eventJoins: [eventJoin("purchase", "purchase")],
				filter: isNotNullPred(eventProp("purchase", "price")),
				sort: sortByExpr("desc", eventProp("purchase", "price")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("event.purchase.properties.price"),
					propertyReference("event.purchase.properties.store"),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Price", "event.purchase.properties.price"),
					tableColumn("Store", "event.purchase.properties.store"),
					tableColumn("Bottle Size", "event.purchase.properties.bottle_size"),
					tableColumn("Purchased At", "event.purchase.createdAt"),
				],
			),
		},
		{
			trackerId: placesTrackerId,
			name: "Demo: Places – Last Visited",
			icon: "calendar",
			accentColor: "#3B82F6",
			queryDefinition: {
				entitySchemaSlugs: ["place"],
				eventJoins: [eventJoin("visit", "visit")],
				filter: isNotNullPred(eventProp("visit", "date")),
				sort: sortByExpr("desc", eventCol("visit", "createdAt")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("event.visit.properties.date"),
					propertyReference(schemaField("place", "city")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Visit Date", "event.visit.properties.date"),
					tableColumn("City", schemaField("place", "city")),
					tableColumn("Duration (h)", "event.visit.properties.duration_hours"),
					tableColumn("Companions", "event.visit.properties.companions"),
				],
			),
		},
		// ── Computed fields ────────────────────────────────────────────────────
		{
			trackerId: whiskeyTrackerId,
			name: "Demo: Whiskeys – ABV Reference",
			icon: "percent",
			accentColor: "#7C3AED",
			queryDefinition: {
				entitySchemaSlugs: ["whiskey"],
				computedFields: [
					computedField(
						"abv",
						roundExpr(
							arithmetic("divide", schemaProp("whiskey", "proof"), literal(2)),
						),
					),
				],
				sort: sortByExpr("desc", computedRef("abv")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("computed.abv"),
					propertyReference(schemaField("whiskey", "distillery")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Proof", schemaField("whiskey", "proof")),
					tableColumn("ABV (%)", "computed.abv"),
					tableColumn("Distillery", schemaField("whiskey", "distillery")),
					tableColumn("Age", schemaField("whiskey", "age")),
				],
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "Demo: Whiskeys – Quality Tiers",
			icon: "layers",
			accentColor: "#BE185D",
			queryDefinition: {
				entitySchemaSlugs: ["whiskey"],
				computedFields: [
					computedField(
						"tier",
						conditional(
							compare("gte", schemaProp("whiskey", "age"), literal(18)),
							literal("Rare"),
							conditional(
								compare("gte", schemaProp("whiskey", "age"), literal(12)),
								literal("Premium"),
								conditional(
									compare("gte", schemaProp("whiskey", "age"), literal(8)),
									literal("Standard"),
									literal("Young"),
								),
							),
						),
					),
				],
				sort: sortByExpr("desc", schemaProp("whiskey", "age")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("computed.tier"),
					propertyReference(schemaField("whiskey", "type")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Age", schemaField("whiskey", "age")),
					tableColumn("Tier", "computed.tier"),
					tableColumn("Type", schemaField("whiskey", "type")),
					tableColumn("Region", schemaField("whiskey", "region")),
				],
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "Demo: Whiskeys – Full Description",
			icon: "file-text",
			accentColor: "#0284C7",
			queryDefinition: {
				entitySchemaSlugs: ["whiskey"],
				computedFields: [
					computedField(
						"description",
						concat(
							coalesceExpr(schemaProp("whiskey", "type"), literal("Unknown")),
							literal(" from "),
							coalesceExpr(
								schemaProp("whiskey", "region"),
								literal("Unknown Region"),
							),
							literal(" ("),
							coalesceExpr(
								schemaProp("whiskey", "distillery"),
								literal("Unknown Distillery"),
							),
							literal(")"),
						),
					),
				],
				sort: sortDefinition("asc", "@name"),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "type")),
					propertyReference("computed.description"),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Description", "computed.description"),
					tableColumn("Proof", schemaField("whiskey", "proof")),
				],
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "Demo: Whiskeys – Rating with ABV",
			icon: "activity",
			accentColor: "#C026D3",
			queryDefinition: {
				entitySchemaSlugs: ["whiskey"],
				eventJoins: [eventJoin("tasting", "tasting")],
				computedFields: [
					computedField(
						"abv",
						roundExpr(
							arithmetic("divide", schemaProp("whiskey", "proof"), literal(2)),
						),
					),
					computedField(
						"value_score",
						conditional(
							andPred(
								compare("gte", eventProp("tasting", "rating"), literal(7)),
								compare("lte", computedRef("abv"), literal(50)),
							),
							literal("Great Value"),
							literal("Standard"),
						),
					),
				],
				filter: isNotNullPred(eventProp("tasting", "rating")),
				sort: sortByExpr("desc", eventProp("tasting", "rating")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("computed.value_score"),
					propertyReference("computed.abv"),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Rating", "event.tasting.properties.rating"),
					tableColumn("ABV (%)", "computed.abv"),
					tableColumn("Value Score", "computed.value_score"),
				],
			),
		},
		// ── Complex filters ────────────────────────────────────────────────────
		{
			trackerId: whiskeyTrackerId,
			name: "Demo: Whiskeys – Rare Bourbons",
			icon: "award",
			accentColor: "#92400E",
			queryDefinition: {
				entitySchemaSlugs: ["whiskey"],
				filter: andPred(
					compare("eq", schemaProp("whiskey", "type"), literal("Bourbon")),
					compare("gte", schemaProp("whiskey", "age"), literal(15)),
					compare("gte", schemaProp("whiskey", "proof"), literal(100)),
				),
				sort: sortDefinition("desc", schemaField("whiskey", "age")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "age")),
					propertyReference(schemaField("whiskey", "distillery")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Age", schemaField("whiskey", "age")),
					tableColumn("Proof", schemaField("whiskey", "proof")),
					tableColumn("Distillery", schemaField("whiskey", "distillery")),
				],
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "Demo: Whiskeys – Not Rye",
			icon: "x-circle",
			accentColor: "#6B7280",
			queryDefinition: {
				entitySchemaSlugs: ["whiskey"],
				filter: notPred(
					compare("eq", schemaProp("whiskey", "type"), literal("Rye")),
				),
				sort: sortDefinition("asc", "@name"),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "type")),
					propertyReference(schemaField("whiskey", "region")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Type", schemaField("whiskey", "type")),
					tableColumn("Region", schemaField("whiskey", "region")),
					tableColumn("Proof", schemaField("whiskey", "proof")),
				],
			),
		},
		{
			trackerId: whiskeyTrackerId,
			name: "Demo: Whiskeys – Bourbon or Scotch, High Proof",
			icon: "zap",
			accentColor: "#B45309",
			queryDefinition: {
				entitySchemaSlugs: ["whiskey"],
				filter: andPred(
					inPred(schemaProp("whiskey", "type"), [
						literal("Bourbon"),
						literal("Scotch"),
					]),
					compare("gte", schemaProp("whiskey", "proof"), literal(100)),
				),
				sort: sortByExpr(
					"desc",
					coalesceExpr(schemaProp("whiskey", "age"), literal(0)),
				),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "type")),
					propertyReference(schemaField("whiskey", "proof")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Type", schemaField("whiskey", "type")),
					tableColumn("Proof", schemaField("whiskey", "proof")),
					tableColumn("Age", schemaField("whiskey", "age")),
				],
			),
		},
		// ── isNull / isNotNull ─────────────────────────────────────────────────
		{
			trackerId: whiskeyTrackerId,
			name: "Demo: Whiskeys – Unknown Region",
			icon: "help-circle",
			accentColor: "#9CA3AF",
			queryDefinition: {
				entitySchemaSlugs: ["whiskey"],
				filter: isNullPred(schemaProp("whiskey", "region")),
				sort: sortDefinition("asc", "@name"),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "type")),
					propertyReference(schemaField("whiskey", "distillery")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Type", schemaField("whiskey", "type")),
					tableColumn("Distillery", schemaField("whiskey", "distillery")),
					tableColumn("Proof", schemaField("whiskey", "proof")),
				],
			),
		},
		{
			trackerId: placesTrackerId,
			name: "Demo: Places – Has Full Address",
			icon: "map-pin",
			accentColor: "#0F766E",
			queryDefinition: {
				entitySchemaSlugs: ["place"],
				filter: andPred(
					isNotNullPred(schemaProp("place", "address")),
					isNotNullPred(schemaProp("place", "city")),
				),
				sort: sortDefinition("asc", schemaField("place", "city")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("place", "city")),
					propertyReference(schemaField("place", "address")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("City", schemaField("place", "city")),
					tableColumn("Address", schemaField("place", "address")),
					tableColumn("Country", schemaField("place", "country")),
				],
			),
		},
		// ── contains / neq ─────────────────────────────────────────────────────
		{
			trackerId: whiskeyTrackerId,
			name: "Demo: Whiskeys – Speyside",
			icon: "map",
			accentColor: "#064E3B",
			queryDefinition: {
				entitySchemaSlugs: ["whiskey"],
				filter: containsPred(schemaProp("whiskey", "region"), literal("side")),
				sort: sortDefinition("asc", schemaField("whiskey", "distillery")),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("whiskey", "region")),
					propertyReference(schemaField("whiskey", "distillery")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Region", schemaField("whiskey", "region")),
					tableColumn("Distillery", schemaField("whiskey", "distillery")),
					tableColumn("Age", schemaField("whiskey", "age")),
				],
			),
		},
		{
			trackerId: phonesTrackerId,
			name: "Demo: Phones – Non-Apple",
			icon: "smartphone",
			accentColor: "#1E40AF",
			queryDefinition: {
				entitySchemaSlugs: ["smartphone", "tablet"],
				filter: orPred(
					compare(
						"neq",
						schemaProp("smartphone", "manufacturer"),
						literal("Apple"),
					),
					compare(
						"neq",
						schemaProp("tablet", "manufacturer"),
						literal("Apple"),
					),
				),
				sort: sortDefinition("asc", "@name"),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("smartphone.manufacturer", "tablet.manufacturer"),
					propertyReference("smartphone.os", "tablet.os"),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn(
						"Manufacturer",
						"smartphone.manufacturer",
						"tablet.manufacturer",
					),
					tableColumn("OS", "smartphone.os", "tablet.os"),
					tableColumn("Year", "smartphone.year", "tablet.year"),
				],
			),
		},
	];

	const sections = [
		["whiskey-related", whiskeyViews],
		["place-related", placeViews],
		["phone-related", phoneViews],
		["cross-tracker", crossTrackerViews],
		["demo", demoViews],
	] as const;

	for (const [label, views] of sections) {
		console.log(`  Creating ${label} saved views...`);

		for (const view of views) {
			savedViews.push(
				await createSavedView(
					client,
					view.name,
					view.icon,
					view.accentColor,
					view.queryDefinition,
					view.displayConfiguration,
					view.trackerId,
				),
			);
		}
	}

	console.log(`  ✓ Created ${savedViews.length} saved views`);
	return savedViews.length;
}

async function main() {
	console.log("🌱 Ryot Seed Script");
	console.log("━".repeat(50));

	console.log(`✓ API Base URL: ${API_BASE_URL}`);

	const { cookies, email, password } = await createAndSignIn();
	console.log(`✓ Created and signed in as ${email}`);

	const client = new APIClient(cookies);
	const startTime = dayjs();

	const whiskeyStats = await seedWhiskeys(client);
	const placeStats = await seedPlaces(client);
	const phoneStats = await seedMobilePhones(client);
	const mediaStats = await seedMedia(client);
	const savedViewsCount = await seedSavedViews(
		client,
		whiskeyStats.tracker.id,
		placeStats.tracker.id,
		phoneStats.tracker.id,
	);
	const collectionStats = await seedCollections(client, {
		phones: phoneStats.entities,
		places: placeStats.entities,
		whiskeys: whiskeyStats.entities,
	});

	const duration = Math.floor(dayjs().diff(startTime, "second", true));
	const minutes = Math.floor(duration / 60);
	const seconds = duration % 60;

	console.log(`\n${"━".repeat(50)}`);
	console.log("📊 Summary:");
	console.log("  Custom Trackers: 3");
	console.log("  Entity Schemas: 5 (1 whiskey + 1 place + 3 phones)");
	console.log("  Event Schemas: 5 (2 whiskey + 3 place)");
	console.log(
		`  Custom Entities: ${whiskeyStats.entityCount + placeStats.entityCount + phoneStats.entityCount}`,
	);
	console.log(
		`  Custom Events: ${whiskeyStats.eventCount + placeStats.eventCount}`,
	);
	console.log(
		`  Media Entities: ${mediaStats.entityCount} (${(mediaStats.entityCount / 11) | 0}+ per type across 11 schemas)`,
	);
	console.log(
		`  Media Events: ${mediaStats.eventCount} (backlog, progress, complete, review)`,
	);
	console.log(`  Collections: ${collectionStats.collectionCount}`);
	console.log(
		`  Collection Memberships: ${collectionStats.membershipCount} (${collectionStats.nestedCollectionMembershipCount} nested collections)`,
	);
	console.log(`  Saved Views: ${savedViewsCount}`);
	console.log(`  API Requests: ${client.getRequestCount()}`);
	console.log(`  Duration: ${minutes}m ${seconds}s`);
	console.log("━".repeat(50));
	console.log("✅ Seed completed successfully!");
	console.log("\n🔑 Credentials:");
	console.log(`  Email:    ${email}`);
	console.log(`  Password: ${password}`);
}

main().catch((error) => {
	console.error("\n❌ Seed failed:");
	console.error(error);
	process.exit(1);
});
