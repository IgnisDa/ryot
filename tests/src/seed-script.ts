/* oxlint-disable */
// TODO: delete this file eventually
import { faker } from "@faker-js/faker";
import { runContract, type ContractProgram } from "@ryot/contract/client";
import type { QueryExpression, RuntimeRef } from "@ryot/contract/display-configuration";
import { RemoteImageUrl, SandboxScriptId } from "@ryot/contract/schema/brands";
import { imagesField } from "@ryot/contract/schema/core";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { buildQueryEngineEntityRowsDocument } from "@ryot/query-engine/documents";
import {
	queryEngineField,
	queryEngineOrder,
	queryEngineSystemRef,
} from "@ryot/query-engine/primitives";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { createAuthClient } from "better-auth/client";

import { requirePresent } from "~/support/assertions";

import { adminHeaders } from "./fixtures/admin";
import { cookieHeaderFromSetCookies, enableTwoFactorForSession } from "./fixtures/auth-2fa";
import type { ContractPayload, ContractSuccess } from "./fixtures/contract-client";

type EntitySchemaSlug = ContractPayload<"entities", "create">["entitySchemaSlug"];
type PluginSlug = string;

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:8000";
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8000/api";

async function createAndSignIn(): Promise<{
	email: string;
	cookies: string;
	password: string;
	backupCodes: string[];
	totpCodes: { past: string; future: string; current: string };
}> {
	const email = `seed-${dayjs().valueOf()}@example.com`;
	const password = email;
	const authClient = createAuthClient({ baseURL: new URL(API_BASE_URL).origin });

	const { error: signUpError } = await authClient.signUp.email({
		email,
		name: "Seed User",
		password,
	});

	if (signUpError) {
		throw new Error(`Sign up failed: ${signUpError.message}`);
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

	const setCookies = signInResponse.headers.getSetCookie();
	if (!setCookies.length) {
		throw new Error("Sign in succeeded but no cookies were returned");
	}
	const cookies = cookieHeaderFromSetCookies(setCookies);

	const twoFactor = await enableTwoFactorForSession({
		baseUrl: API_BASE_URL,
		origin: FRONTEND_URL,
		cookies,
		password,
	});

	return {
		cookies: twoFactor.cookies,
		email,
		password,
		backupCodes: twoFactor.backupCodes,
		totpCodes: twoFactor.totpCodes,
	};
}

type CreateCollectionBody = ContractPayload<"collections", "create">;
type AddToCollectionBody = ContractPayload<"collections", "createMembership">;
type CreateSavedViewBody = ContractPayload<"savedViews", "create">;
type SavedViewQueryDocument = CreateSavedViewBody["queryDocument"];
type SavedViewDisplayConfiguration = CreateSavedViewBody["displayConfiguration"];
type SavedViewTableColumn = {
	label: string;
	expression?: SavedViewDisplayConfiguration["table"]["columns"][number]["expression"];
	property?: string[];
};
type SavedViewExpression = QueryExpression;
type SavedViewQueryEngineRef = RuntimeRef;
type SavedViewDisplayConfigInput = {
	entityIdProperty?: string[] | null;
	grid: {
		eyebrowProperty: string[] | null;
		imageProperty: string[] | null;
		titleProperty: string[] | null;
		calloutProperty: string[] | null;
		primarySubtitleProperty: string[] | null;
		secondarySubtitleProperty: string[] | null;
	};
	list: {
		eyebrowProperty: string[] | null;
		imageProperty: string[] | null;
		titleProperty: string[] | null;
		calloutProperty: string[] | null;
		primarySubtitleProperty: string[] | null;
		secondarySubtitleProperty: string[] | null;
	};
	table: { columns: SavedViewTableColumn[] };
};

type SavedViewSpec = {
	name: string;
	icon: string;
	trackerId?: PluginSlug;
	accentColor: string;
	queryDocument: SavedViewQueryDocument;
	displayConfiguration: SavedViewDisplayConfigInput;
};

class APIClient {
	private cookies: string;
	private requestCount = 0;

	constructor(cookies: string) {
		this.cookies = cookies;
	}

	run<A, E>(program: ContractProgram<A, E>): Promise<A> {
		this.requestCount++;
		return runContract(program, { baseUrl: API_BASE_URL, headers: { Cookie: this.cookies } });
	}

	runAdmin<A, E>(program: ContractProgram<A, E>): Promise<A> {
		this.requestCount++;
		return runContract(program, { baseUrl: API_BASE_URL, headers: adminHeaders });
	}

	getRequestCount(): number {
		return this.requestCount;
	}
}

async function seedSandboxScript(apiClient: APIClient) {
	const value = `seed-script-${dayjs().valueOf()}`;
	const source = `
import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk/core";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
  requiredAppConfigKeys: [],
  name: "Seed script",
  slug: ${JSON.stringify(value)},
});

const main = defineDriver(manifest, {
  input: z.object({}),
  output: z.literal(${JSON.stringify(value)}),
  run: async () => ${JSON.stringify(value)} as const,
});

export default defineScript({ manifest, drivers: { main } });
`;
	const script = await apiClient.run((c) => c.sandbox.createScript({ payload: { source } }));
	const queued = await apiClient.run((c) =>
		c.sandbox.enqueue({ payload: { context: {}, driverName: "main", scriptId: script.id } }),
	);
	const startedAt = dayjs();
	while (dayjs().diff(startedAt, "second") < 120) {
		// oxlint-disable-next-line no-await-in-loop
		const result = await apiClient.run((c) =>
			c.sandbox.getResult({ path: { jobId: queued.jobId } }),
		);
		if (result.status === "pending") {
			// oxlint-disable-next-line no-await-in-loop
			await sleep(250);
			continue;
		}
		if (result.status === "failed") {
			throw new Error(`Seed sandbox job failed: ${result.error}`);
		}
		if (result.error) {
			throw new Error(`Seed sandbox execution failed: ${JSON.stringify(result.error)}`);
		}
		if (result.value !== value) {
			throw new Error(`Seed sandbox returned ${JSON.stringify(result.value)}`);
		}
		console.log(`✓ Created and executed format-1 sandbox script ${script.id}`);
		return;
	}
	throw new Error("Seed sandbox execution timed out");
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

async function createPluginScope(
	_apiClient: APIClient,
	name: string,
	slug: string,
	icon: string,
	accentColor: string,
	description?: string,
) {
	console.log(`  Creating plugin scope: ${name}...`);
	const definition = {
		name,
		slug,
		icon,
		accentColor,
		description: description ?? null,
		sortOrder: 0,
	};
	const plugin = { ...definition, id: slug };

	console.log(`  ✓ Created plugin scope: ${name} (${plugin.id})`);
	return plugin;
}

async function createEntitySchema(
	apiClient: APIClient,
	name: string,
	slug: string,
	pluginSlug: PluginSlug,
	icon: string,
	accentColor: string,
	propertiesSchema: AppSchema,
) {
	console.log(`    Creating entity schema: ${name}...`);
	// Every entity schema gets an images property; card views read the first image from it.
	const propertiesSchemaWithImages: AppSchema = {
		...propertiesSchema,
		fields: { images: imagesField("Cover and promotional images"), ...propertiesSchema.fields },
	};
	const definition = {
		name,
		slug,
		icon,
		pluginSlug,
		accentColor,
		propertiesSchema: propertiesSchemaWithImages,
		eventSchemas: [],
	};
	await apiClient.runAdmin((c) =>
		c.testSupport.installDefinitions({
			payload: {
				entitySchemas: [definition],
			},
		}),
	);
	const schema = { ...definition, id: slug as EntitySchemaSlug };

	console.log(`    ✓ Created entity schema: ${name} (${schema.id})`);
	return schema;
}

async function createEventSchema(
	apiClient: APIClient,
	name: string,
	slug: string,
	entitySchemaSlug: EntitySchemaSlug,
	propertiesSchema: AppSchema,
) {
	console.log(`      Creating event schema: ${name}...`);
	const schemas = await apiClient.run((c) => c.definitions.listEntities({}));
	const entitySchema = requirePresent(
		schemas.find((schema) => schema.slug === entitySchemaSlug),
		`Entity schema '${entitySchemaSlug}' not found`,
	);
	const definition = { name, slug, propertiesSchema };
	await apiClient.runAdmin((c) =>
		c.testSupport.installDefinitions({
			payload: {
				entitySchemas: [
					{
						...entitySchema,
						eventSchemas: [
							...entitySchema.eventSchemas.filter((schema) => schema.slug !== slug),
							definition,
						],
					},
				],
			},
		}),
	);
	const schema = { ...definition, id: slug };

	console.log(`      ✓ Created event schema: ${name} (${schema.id})`);
	return schema;
}

async function createEntity(
	apiClient: APIClient,
	name: string,
	entitySchemaSlug: EntitySchemaSlug,
	properties: Record<string, unknown>,
	imageUrl: string | null,
) {
	return apiClient.run((c) =>
		c.entities.create({
			payload: {
				name,
				entitySchemaSlug,
				properties: imageUrl
					? { ...properties, images: [{ type: "remote", url: RemoteImageUrl.make(imageUrl) }] }
					: properties,
			},
		}),
	);
}

async function createCollection(apiClient: APIClient, body: CreateCollectionBody) {
	console.log(`  Creating collection: ${body.name}...`);
	const collection = await apiClient.run((c) => c.collections.create({ payload: body }));

	console.log(`  ✓ Created collection: ${body.name} (${collection.id})`);
	return collection;
}

async function addEntityToCollection(apiClient: APIClient, body: AddToCollectionBody) {
	return apiClient.run((c) => c.collections.createMembership({ payload: body }));
}

type SeedEntity = Awaited<ReturnType<typeof createEntity>>;

type EventPayload = ContractPayload<"events", "create">[number];

async function createEvents(apiClient: APIClient, events: EventPayload[]): Promise<void> {
	if (events.length === 0) {
		return;
	}
	await apiClient.run((c) => c.events.create({ payload: events }));
}

const literalExpression = (value: unknown): SavedViewExpression => ({
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

			return { type: "event-join", joinKey: segment, path: [third, ...rest] };
		}

		if (rest.length > 0) {
			throw new Error(`Invalid saved view reference '${reference}'`);
		}

		return { type: "event-join", joinKey: segment, path: [third] };
	}

	throw new Error(`Invalid saved view reference '${reference}'`);
};

function savedViewQueryDocument(scope: readonly string[]): SavedViewQueryDocument {
	const [first, ...rest] = scope;

	if (!first) {
		throw new Error("Saved view query document requires at least one schema");
	}

	const schemas = [first, ...rest] as [string, ...string[]];
	const nameRef = queryEngineSystemRef(first, "name");
	return buildQueryEngineEntityRowsDocument({
		alias: first,
		limit: 20,
		schemas,
		fields: [queryEngineField("name", nameRef)],
		orderBy: [queryEngineOrder("asc", nameRef)],
	});
}

async function createSavedView(
	apiClient: APIClient,
	name: string,
	icon: string,
	accentColor: string,
	queryDocument: SavedViewQueryDocument,
	displayConfiguration: SavedViewDisplayConfigInput,
	trackerId?: PluginSlug,
) {
	const sourceSchemas =
		queryDocument.source.type === "entities"
			? queryDocument.source.schemas
			: queryDocument.source.type === "events"
				? queryDocument.source.entity.schemas
				: queryDocument.source.sourceEntity.schemas;
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
		return sourceSchemas.map((schemaSlug) => {
			// The `@image` shorthand resolves to the first image in the images property.
			if (column === "image") {
				return `entity.${schemaSlug}.properties.images.0`;
			}
			return `entity.${schemaSlug}.${column}`;
		});
	};

	const normalizedDisplayConfiguration: SavedViewDisplayConfiguration = {
		entityIdProperty:
			toExpression(
				displayConfiguration.entityIdProperty ??
					sourceSchemas.map((slug) => schemaField(slug, "id")),
			) ?? literalExpression(null),
		grid: {
			...displayConfiguration.grid,
			eyebrowProperty: toExpression(displayConfiguration.grid.eyebrowProperty) ?? null,
			imageProperty: toExpression(displayConfiguration.grid.imageProperty) ?? null,
			titleProperty:
				toExpression(displayConfiguration.grid.titleProperty) ?? literalExpression(null),
			calloutProperty: toExpression(displayConfiguration.grid.calloutProperty) ?? null,
			primarySubtitleProperty:
				toExpression(displayConfiguration.grid.primarySubtitleProperty) ?? null,
			secondarySubtitleProperty:
				toExpression(displayConfiguration.grid.secondarySubtitleProperty) ?? null,
		},
		list: {
			...displayConfiguration.list,
			eyebrowProperty: toExpression(displayConfiguration.list.eyebrowProperty) ?? null,
			imageProperty: toExpression(displayConfiguration.list.imageProperty) ?? null,
			titleProperty:
				toExpression(displayConfiguration.list.titleProperty) ?? literalExpression(null),
			calloutProperty: toExpression(displayConfiguration.list.calloutProperty) ?? null,
			primarySubtitleProperty:
				toExpression(displayConfiguration.list.primarySubtitleProperty) ?? null,
			secondarySubtitleProperty:
				toExpression(displayConfiguration.list.secondarySubtitleProperty) ?? null,
		},
		table: {
			columns: displayConfiguration.table.columns.map((column) => ({
				label: column.label,
				expression:
					toExpression(column.property ?? column.expression ?? null) ?? literalExpression(null),
			})),
		},
	};

	return apiClient.run((c) =>
		c.savedViews.create({
			payload: {
				name,
				icon,
				accentColor,
				pluginSlug: trackerId,
				queryDocument,
				displayConfiguration: normalizedDisplayConfiguration,
			},
		}),
	);
}

// ─── Display helpers ─────────────────────────────────────────────────────────

function propertyReference(...fields: string[]) {
	return fields;
}

function schemaField(schemaSlug: string, property: string) {
	const entityBuiltins = new Set([
		"id",
		"name",
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
	calloutProperty: string[] | null,
	primarySubtitleProperty: string[] | null,
	secondarySubtitleProperty: string[] | null = null,
	eyebrowProperty: string[] | null = null,
): {
	eyebrowProperty: string[] | null;
	imageProperty: string[] | null;
	titleProperty: string[] | null;
	calloutProperty: string[] | null;
	primarySubtitleProperty: string[] | null;
	secondarySubtitleProperty: string[] | null;
} {
	return {
		eyebrowProperty,
		imageProperty,
		titleProperty,
		calloutProperty,
		primarySubtitleProperty,
		secondarySubtitleProperty,
	};
}

function tableColumn(label: string, ...property: string[]): SavedViewTableColumn {
	return { label, property };
}

function buildDisplayConfiguration(
	grid: {
		eyebrowProperty: string[] | null;
		imageProperty: string[] | null;
		titleProperty: string[] | null;
		calloutProperty: string[] | null;
		primarySubtitleProperty: string[] | null;
		secondarySubtitleProperty: string[] | null;
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
	const manufacturers = ["Apple", "Samsung", "Google", "OnePlus", "Xiaomi", "Sony"];
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

	const tracker = await createPluginScope(
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
					description: "Distillery that produced the whiskey",
					validation: { required: true },
				},
				age: {
					type: "integer",
					label: "Age",
					description: "Age of the whiskey in years",
				},
				region: {
					type: "string",
					label: "Region",
					description: "Region where the whiskey was produced",
				},
				proof: {
					type: "number",
					label: "Proof",
					description: "Proof of the whiskey",
				},
				type: {
					type: "string",
					label: "Type",
					description: "Type of whiskey",
				},
			},
		},
	);

	const tastingSchema = await createEventSchema(client, "Tasting", "tasting", entitySchema.id, {
		fields: {
			rating: {
				type: "integer",
				label: "Rating",
				description: "Rating for the tasting",
				validation: { required: true, maximum: 10, minimum: 1 },
			},
			notes: {
				type: "string",
				label: "Notes",
				description: "Tasting notes",
			},
			location: {
				type: "string",
				label: "Location",
				description: "Location where the tasting took place",
			},
		},
	});

	const purchaseSchema = await createEventSchema(client, "Purchase", "purchase", entitySchema.id, {
		fields: {
			price: {
				type: "number",
				label: "Price",
				description: "Purchase price",
				validation: { required: true },
			},
			store: {
				type: "string",
				label: "Store",
				description: "Store where the whiskey was purchased",
			},
			bottle_size: {
				type: "integer",
				label: "Bottle Size",
				description: "Bottle size in ml",
			},
		},
	});

	const entityCount = randomInt(90, 110);
	console.log(`\n  Creating ${entityCount} whiskey entities...`);

	const entities: Awaited<ReturnType<typeof createEntity>>[] = [];
	for (let i = 0; i < entityCount; i++) {
		const whiskey = generateWhiskey();
		// oxlint-disable-next-line no-await-in-loop
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
				schema.id === tastingSchema.id ? generateWhiskeyTasting() : generateWhiskeyPurchase();

			whiskeyEvents.push({
				properties,
				entityId: entity.id,
				eventSchemaSlug: schema.id,
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

	const tracker = await createPluginScope(
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
				city: {
					type: "string",
					label: "City",
					description: "City where the place is located",
					validation: { required: true },
				},
				country: {
					type: "string",
					label: "Country",
					description: "Country where the place is located",
					validation: { required: true },
				},
				type: {
					type: "string",
					label: "Type",
					description: "Type of place",
				},
				address: {
					type: "string",
					label: "Address",
					description: "Street address of the place",
				},
				latitude: {
					type: "number",
					label: "Latitude",
					description: "Latitude coordinate",
				},
				longitude: {
					type: "number",
					label: "Longitude",
					description: "Longitude coordinate",
				},
			},
		},
	);

	const visitSchema = await createEventSchema(client, "Visit", "visit", entitySchema.id, {
		fields: {
			date: {
				type: "date",
				label: "Date",
				description: "Date of the visit",
				validation: { required: true },
			},
			duration_hours: {
				type: "number",
				label: "Duration Hours",
				description: "Duration of the visit in hours",
			},
			companions: {
				type: "string",
				label: "Companions",
				description: "People who accompanied you",
			},
			notes: {
				type: "string",
				label: "Notes",
				description: "Notes about the visit",
			},
		},
	});

	const ratingSchema = await createEventSchema(client, "Rating", "rating", entitySchema.id, {
		fields: {
			rating: {
				type: "integer",
				label: "Rating",
				description: "Rating for the place",
				validation: { required: true, maximum: 5, minimum: 1 },
			},
			review: {
				type: "string",
				label: "Review",
				description: "Written review",
			},
			would_return: {
				type: "boolean",
				label: "Would Return",
				description: "Whether you would return to this place",
			},
		},
	});

	const photoSchema = await createEventSchema(client, "Photo", "photo", entitySchema.id, {
		fields: {
			photo_url: {
				type: "string",
				label: "Photo URL",
				description: "URL of the photo",
			},
			caption: {
				type: "string",
				label: "Caption",
				description: "Caption for the photo",
			},
		},
	});

	const entityCount = randomInt(90, 110);
	console.log(`\n  Creating ${entityCount} place entities...`);

	const entities: Awaited<ReturnType<typeof createEntity>>[] = [];
	for (let i = 0; i < entityCount; i++) {
		const place = generatePlace();
		// oxlint-disable-next-line no-await-in-loop
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
				eventSchemaSlug: schema.id,
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

	const tracker = await createPluginScope(
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
					description: "Manufacturer of the smartphone",
					validation: { required: true },
				},
				year: {
					type: "integer",
					label: "Year",
					description: "Release year",
				},
				os: {
					type: "string",
					label: "OS",
					description: "Operating system",
				},
				screen_size: {
					type: "number",
					label: "Screen Size",
					description: "Screen size in inches",
				},
				storage_gb: {
					type: "integer",
					label: "Storage GB",
					description: "Storage capacity in GB",
				},
				ram_gb: {
					type: "integer",
					label: "RAM GB",
					description: "RAM capacity in GB",
				},
				price_usd: {
					type: "number",
					label: "Price USD",
					description: "Price in USD",
				},
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
					description: "Manufacturer of the feature phone",
					validation: { required: true },
				},
				year: {
					type: "integer",
					label: "Year",
					description: "Release year",
				},
				has_camera: {
					type: "boolean",
					label: "Has Camera",
					description: "Whether the phone has a camera",
				},
				battery_mah: {
					type: "integer",
					label: "Battery mAh",
					description: "Battery capacity in mAh",
				},
				color: {
					type: "string",
					label: "Color",
					description: "Color of the phone",
				},
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
					description: "Manufacturer of the tablet",
					validation: { required: true },
				},
				year: {
					type: "integer",
					label: "Year",
					description: "Release year",
				},
				screen_size: {
					type: "number",
					label: "Screen Size",
					description: "Screen size in inches",
				},
				os: {
					type: "string",
					label: "OS",
					description: "Operating system",
				},
				storage_gb: {
					type: "integer",
					label: "Storage GB",
					description: "Storage capacity in GB",
				},
				has_cellular: {
					type: "boolean",
					label: "Has Cellular",
					description: "Whether the tablet has cellular connectivity",
				},
			},
		},
	);

	console.log("\n  Creating smartphone entities...");
	const smartphoneCount = randomInt(90, 110);
	const entities: SeedEntity[] = [];
	for (let i = 0; i < smartphoneCount; i++) {
		const phone = generateSmartphone();
		// oxlint-disable-next-line no-await-in-loop
		const entity = await createEntity(
			client,
			phone.name,
			smartphoneSchema.id,
			phone.properties,
			generateImageUrl(phone.name, 400, 600),
		);
		entities.push(entity);

		if ((i + 1) % 10 === 0) {
			console.log(`    Progress: ${i + 1}/${smartphoneCount} smartphones created`);
		}
	}
	console.log(`  ✓ Created ${smartphoneCount} smartphones`);

	console.log("\n  Creating feature phone entities...");
	const featurePhoneCount = randomInt(90, 110);
	for (let i = 0; i < featurePhoneCount; i++) {
		const phone = generateFeaturePhone();
		// oxlint-disable-next-line no-await-in-loop
		const entity = await createEntity(
			client,
			phone.name,
			featurePhoneSchema.id,
			phone.properties,
			generateImageUrl(phone.name, 400, 600),
		);
		entities.push(entity);

		if ((i + 1) % 10 === 0) {
			console.log(`    Progress: ${i + 1}/${featurePhoneCount} feature phones created`);
		}
	}
	console.log(`  ✓ Created ${featurePhoneCount} feature phones`);

	console.log("\n  Creating tablet entities...");
	const tabletCount = randomInt(90, 110);
	for (let i = 0; i < tabletCount; i++) {
		const tablet = generateTablet();
		// oxlint-disable-next-line no-await-in-loop
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

// ─── Builtin media plugin helpers ──────────────────────────────────────────

async function getBuiltinWorkspace(apiClient: APIClient) {
	const workspaces = await apiClient.run((c) =>
		c.definitions.listWorkspaces({ urlParams: { includeDisabled: true } }),
	);

	const builtinWorkspace = workspaces[0];
	if (!builtinWorkspace) {
		throw new Error("Built-in media plugin workspace not found");
	}

	return { ...builtinWorkspace, id: builtinWorkspace.slug };
}

async function listMediaEntitySchemas(apiClient: APIClient, pluginSlug: PluginSlug) {
	const [schemas, scripts] = await Promise.all([
		apiClient.run((c) => c.definitions.listEntities({})),
		apiClient.runAdmin((c) => c.testSupport.listSandboxScripts({ urlParams: {} })),
	]);
	return schemas
		.filter((schema) => schema.pluginSlug === pluginSlug)
		.map((schema) => ({
			...schema,
			id: schema.slug as EntitySchemaSlug,
			providers: scripts
				.filter((script) => script.metadata.kind === "provider")
				.filter((script) => script.slug.startsWith(`${schema.slug}.`))
				.map((script) => ({ name: script.name, scriptId: script.id })),
		}));
}

async function getMediaLifecycleEventSchemas(
	apiClient: APIClient,
	entitySchemaSlug: EntitySchemaSlug,
) {
	const entities = await apiClient.run((c) => c.definitions.listEntities({}));
	const schemas = requirePresent(
		entities.find((schema) => schema.slug === entitySchemaSlug),
		`Entity schema '${entitySchemaSlug}' not found`,
	).eventSchemas.map((schema) => ({ ...schema, id: schema.slug }));

	const backlog = schemas.find((s) => s.slug === "backlog");
	const progress = schemas.find((s) => s.slug === "progress");
	const complete = schemas.find((s) => s.slug === "complete");
	const review = schemas.find((s) => s.slug === "review");

	if (!backlog || !complete || !review) {
		throw new Error(`Missing lifecycle event schemas for entity schema ${entitySchemaSlug}`);
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

const MEDIA_SEARCH_QUERIES: Record<MediaEntitySchemaSlug, { query: string; pages: number[] }> = {
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
	const startedAt = Date.now();
	while (true) {
		// oxlint-disable-next-line no-await-in-loop
		const result = await apiClient.run((c) => c.sandbox.getResult({ path: { jobId } }));
		if (result.status === "pending") {
			if (Date.now() - startedAt > 60000) {
				throw new Error(`Search job ${jobId} timed out`);
			}
			// oxlint-disable-next-line no-await-in-loop
			await sleep(500);
			continue;
		}
		if (result.status === "failed") {
			throw new Error(`Search job failed: ${result.error}`);
		}
		const value = result.value as { items?: Array<{ externalId: string }> };
		return value?.items ?? [];
	}
}

async function searchMediaPage(
	apiClient: APIClient,
	scriptId: SandboxScriptId,
	query: string,
	page: number,
): Promise<Array<{ externalId: string }>> {
	const result = await apiClient.run((c) =>
		c.sandbox.enqueue({
			payload: { scriptId, driverName: "search", context: { query, page, pageSize: 10 } },
		}),
	);
	return pollSearchJob(apiClient, result.jobId);
}

async function importMediaEntity(
	apiClient: APIClient,
	scriptId: SandboxScriptId,
	externalId: string,
	entitySchemaSlug: EntitySchemaSlug,
): Promise<SeedEntity | null> {
	let jobId: string;
	try {
		const importResult = await apiClient.run((c) =>
			c.entityImport.import({ payload: { scriptId, externalId, entitySchemaSlug } }),
		);
		jobId = importResult.jobId;
	} catch {
		return null;
	}
	const startedAt = Date.now();
	while (true) {
		let result: ContractSuccess<"entityImport", "getImportResult">;
		try {
			// oxlint-disable-next-line no-await-in-loop
			result = await apiClient.run((c) => c.entityImport.getImportResult({ path: { jobId } }));
		} catch {
			return null;
		}
		if (result.status === "pending") {
			if (Date.now() - startedAt > 60000) {
				return null;
			}
			// oxlint-disable-next-line no-await-in-loop
			await sleep(500);
			continue;
		}
		if (result.status === "failed") {
			return null;
		}
		return result.data;
	}
}

// ─── Episodic progress helpers ───────────────────────────────────────────────

const EPISODIC_MEDIA_SLUGS = new Set<MediaEntitySchemaSlug>(["show", "anime", "manga"]);

function generateEpisodicProgressFields(slug: MediaEntitySchemaSlug): Record<string, unknown> {
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
	return {};
}

// ─── Media seeding ──────────────────────────────────────────────────────────

async function seedMedia(client: APIClient) {
	console.log("\n🎬 Seeding Media Tracker...");

	const builtinTracker = await getBuiltinWorkspace(client);
	console.log(`  Found builtin plugin: ${builtinTracker.name} (${builtinTracker.id})`);

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

	type MediaEventSchemas = Awaited<ReturnType<typeof getMediaLifecycleEventSchemas>>;
	type WorkItem = {
		externalId: string;
		scriptId: SandboxScriptId;
		schema: (typeof schemas)[number];
		eventSchemas: MediaEventSchemas;
	};

	// Phase 1: search all schemas (all providers) and collect work items
	const workItems: WorkItem[] = [];
	for (const schema of schemas) {
		const slug = schema.slug as MediaEntitySchemaSlug;
		console.log(`\n  Searching: ${schema.name} (${slug})...`);
		// oxlint-disable-next-line no-await-in-loop
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
					// oxlint-disable-next-line no-await-in-loop
					const items = await searchMediaPage(client, scriptId, searchConfig.query, page);
					for (const item of items) {
						if (!identifiers.includes(item.externalId)) {
							identifiers.push(item.externalId);
						}
					}
					console.log(`      Search "${searchConfig.query}" page ${page}: ${items.length} results`);
				} catch (err) {
					console.log(`      Search page ${page} failed:`, err);
				}
			}
			console.log(`    Collected ${identifiers.length} unique identifiers from ${provider.name}`);

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
	console.log(`\n  Importing ${workItems.length} entities (shuffled across all types)...`);

	// Phase 3: import in shuffled order, group results by schema id
	const entitiesBySchemaId = new Map<string, SeedEntity[]>();
	const eventSchemasBySchemaId = new Map<string, MediaEventSchemas>();

	for (const [index, item] of workItems.entries()) {
		// oxlint-disable-next-line no-await-in-loop
		const entity = await importMediaEntity(client, item.scriptId, item.externalId, item.schema.id);
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
		const progressCount = eventSchemas.progress ? Math.ceil(entityCount * 0.2) : 0;
		const completeNoReviewCount = Math.ceil(entityCount * 0.24);

		const backlogEntities = entities.slice(0, backlogCount);
		const progressEntities = entities.slice(backlogCount, backlogCount + progressCount);
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
				eventSchemaSlug: eventSchemas.backlog.id,
			});
		}

		for (const entity of progressEntities) {
			if (!eventSchemas.progress) {
				continue;
			}
			const slug = schema.slug as MediaEntitySchemaSlug;
			const episodicFields = EPISODIC_MEDIA_SLUGS.has(slug)
				? generateEpisodicProgressFields(slug)
				: {};
			mediaEvents.push({
				entityId: entity.id,
				eventSchemaSlug: eventSchemas.progress.id,
				properties: { progressPercent: randomInt(10, 85), ...episodicFields },
			});
		}

		for (const entity of completeNoReviewEntities) {
			mediaEvents.push({
				entityId: entity.id,
				eventSchemaSlug: eventSchemas.complete.id,
				properties: randomChoice(completionVariants)(),
			});
		}

		for (const entity of completeWithReviewEntities) {
			mediaEvents.push({
				entityId: entity.id,
				eventSchemaSlug: eventSchemas.complete.id,
				properties: randomChoice(completionVariants)(),
			});
			mediaEvents.push({
				entityId: entity.id,
				eventSchemaSlug: eventSchemas.review.id,
				properties: {
					rating: randomInt(1, 5),
					...(faker.datatype.boolean() ? { review: faker.lorem.sentences(randomInt(1, 3)) } : {}),
				},
			});
		}

		// oxlint-disable-next-line no-await-in-loop
		await createEvents(client, mediaEvents);
		console.log(`    ${schema.name}: ${entities.length} entities, ${mediaEvents.length} events`);

		totalEntities += entities.length;
		totalEvents += mediaEvents.length;
	}

	console.log(`\n  ✓ Media seeding complete: ${totalEntities} entities, ${totalEvents} events`);

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
					description: "Tags for the whiskey",
					items: {
						type: "string" as const,
						label: "Tag",
						description: "A single tag",
					},
				},
				notes: {
					type: "string" as const,
					label: "Notes",
					description: "Notes about the whiskey",
				},
				rating: {
					type: "integer" as const,
					label: "Rating",
					description: "Rating for the whiskey",
				},
				context: {
					type: "object" as const,
					label: "Context",
					description: "Context for the recommendation",
					unknownKeys: "passthrough" as const,
					properties: {
						mood: {
							type: "string" as const,
							label: "Mood",
							description: "Mood while drinking",
						},
						venue: {
							type: "string" as const,
							label: "Venue",
							description: "Venue where the whiskey was enjoyed",
						},
					},
				},
				recommendedBy: {
					type: "string" as const,
					label: "Recommended By",
					description: "Person who recommended the whiskey",
				},
			},
		},
	} as unknown as CreateCollectionBody);

	const weekendEscapes = await createCollection(client, {
		name: "Weekend Escapes",
		description: "Places worth a short trip or a spontaneous Saturday",
		membershipPropertiesSchema: {
			fields: {
				notes: {
					type: "string" as const,
					label: "Notes",
					description: "Notes about the place",
				},
				priority: {
					type: "integer" as const,
					label: "Priority",
					description: "Visit priority",
				},
				idealSeason: {
					type: "string" as const,
					label: "Ideal Season",
					description: "Ideal season to visit",
				},
				visitWindow: {
					type: "string" as const,
					label: "Visit Window",
					description: "Preferred time of day to visit",
				},
			},
		},
	});

	const pocketFavorites = await createCollection(client, {
		name: "Pocket Favorites",
		description: "Phones and tablets that feel great to keep around",
		membershipPropertiesSchema: {
			fields: {
				notes: {
					type: "string" as const,
					label: "Notes",
					description: "Notes about the device",
				},
				status: {
					type: "string" as const,
					label: "Status",
					description: "Current status of the device",
				},
				carryScore: {
					type: "integer" as const,
					label: "Carry Score",
					description: "How often the device is carried",
				},
			},
		},
	});

	const allStarPicks = await createCollection(client, {
		name: "All-Star Picks",
		description: "Cross-tracker highlights pulled together with ad-hoc notes",
	});

	const collectionGuide = await createCollection(client, {
		name: "Collection Guide",
		description: "A collection of collections for browsing the seeded demo shelves",
		membershipPropertiesSchema: {
			fields: {
				blurb: {
					type: "string" as const,
					label: "Blurb",
					description: "Short description of the collection",
				},
				section: {
					type: "string" as const,
					label: "Section",
					description: "Section this collection belongs to",
				},
				priority: {
					type: "integer" as const,
					label: "Priority",
					description: "Display priority",
				},
			},
		},
	});

	let membershipCount = 0;
	let nestedCollectionMembershipCount = 0;

	console.log("  Adding whiskey memberships...");
	for (const whiskey of faker.helpers.arrayElements(input.whiskeys, 10)) {
		// oxlint-disable-next-line no-await-in-loop
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
	for (const [index, place] of faker.helpers.arrayElements(input.places, 10).entries()) {
		// oxlint-disable-next-line no-await-in-loop
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
		// oxlint-disable-next-line no-await-in-loop
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
		// oxlint-disable-next-line no-await-in-loop
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
		// oxlint-disable-next-line no-await-in-loop
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
	whiskeyTrackerId: PluginSlug,
	placesTrackerId: PluginSlug,
	phonesTrackerId: PluginSlug,
) {
	console.log("\n💾 Seeding Saved Views...");

	const savedViews: Awaited<ReturnType<typeof createSavedView>>[] = [];
	const defaultCard = cardConfig(
		propertyReference("@image"),
		propertyReference("@name"),
		null,
		null,
	);
	const allSchemaSlugs = ["whiskey", "place", "smartphone", "feature-phone", "tablet"];

	const whiskeyViews: SavedViewSpec[] = [
		{
			trackerId: whiskeyTrackerId,
			name: "Premium Aged Whiskeys",
			icon: "wine",
			accentColor: "#D97706",
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["place"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["place"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["place"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["place"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["place"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["place"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["place"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["smartphone"]),
			displayConfiguration: buildDisplayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(schemaField("smartphone", "year")),
					propertyReference(schemaField("smartphone", "manufacturer")),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Manufacturer", schemaField("smartphone", "manufacturer")),
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
			queryDocument: savedViewQueryDocument(["smartphone", "tablet"]),
			displayConfiguration: buildDisplayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Storage", "smartphone.storage_gb", "tablet.storage_gb"),
					tableColumn("Manufacturer", "smartphone.manufacturer", "tablet.manufacturer"),
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
			queryDocument: savedViewQueryDocument(["smartphone", "tablet"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["smartphone", "tablet"]),
			displayConfiguration: buildDisplayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("smartphone.manufacturer", "tablet.manufacturer"),
					propertyReference("smartphone.year", "tablet.year"),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Manufacturer", "smartphone.manufacturer", "tablet.manufacturer"),
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
			queryDocument: savedViewQueryDocument(["smartphone"]),
			displayConfiguration: buildDisplayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Price", schemaField("smartphone", "price_usd")),
					tableColumn("Manufacturer", schemaField("smartphone", "manufacturer")),
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
			queryDocument: savedViewQueryDocument(["smartphone"]),
			displayConfiguration: buildDisplayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Price", schemaField("smartphone", "price_usd")),
					tableColumn("Manufacturer", schemaField("smartphone", "manufacturer")),
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
			queryDocument: savedViewQueryDocument(["smartphone", "tablet"]),
			displayConfiguration: buildDisplayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("smartphone.screen_size", "tablet.screen_size"),
					propertyReference("smartphone.os", "tablet.os"),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Screen Size", "smartphone.screen_size", "tablet.screen_size"),
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
			queryDocument: savedViewQueryDocument(["tablet"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["feature-phone"]),
			displayConfiguration: buildDisplayConfiguration(
				defaultCard,
				[
					tableColumn("Name", "@name"),
					tableColumn("Manufacturer", schemaField("feature-phone", "manufacturer")),
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
			queryDocument: savedViewQueryDocument(["smartphone", "feature-phone", "tablet"]),
			displayConfiguration: buildDisplayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("smartphone.os", "feature-phone.color", "tablet.os"),
					propertyReference(
						"smartphone.manufacturer",
						"feature-phone.manufacturer",
						"tablet.manufacturer",
					),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Primary Field", "smartphone.os", "feature-phone.color", "tablet.os"),
					tableColumn(
						"Manufacturer",
						"smartphone.manufacturer",
						"feature-phone.manufacturer",
						"tablet.manufacturer",
					),
					tableColumn("Year", "smartphone.year", "feature-phone.year", "tablet.year"),
				],
			),
		},
	];

	const crossTrackerViews: SavedViewSpec[] = [
		{
			name: "Everything Recently Added",
			icon: "star",
			accentColor: "#FFD700",
			queryDocument: savedViewQueryDocument(allSchemaSlugs),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(allSchemaSlugs),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(allSchemaSlugs),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["place"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["place"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["whiskey"]),
			displayConfiguration: buildDisplayConfiguration(
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
			queryDocument: savedViewQueryDocument(["smartphone", "tablet"]),
			displayConfiguration: buildDisplayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference("smartphone.manufacturer", "tablet.manufacturer"),
					propertyReference("smartphone.os", "tablet.os"),
				),
				[
					tableColumn("Name", "@name"),
					tableColumn("Manufacturer", "smartphone.manufacturer", "tablet.manufacturer"),
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
				// oxlint-disable-next-line no-await-in-loop
				await createSavedView(
					client,
					view.name,
					view.icon,
					view.accentColor,
					view.queryDocument,
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

	const { backupCodes, cookies, email, password, totpCodes } = await createAndSignIn();
	console.log(`✓ Created and signed in as ${email}`);
	console.log(`✓ Enabled two-factor authentication`);
	console.log(`  Past TOTP:    ${totpCodes.past}`);
	console.log(`  Current TOTP: ${totpCodes.current}`);
	console.log(`  Future TOTP:  ${totpCodes.future}`);
	console.log(`  Backup codes: ${backupCodes.join(", ")}`);

	const client = new APIClient(cookies);
	const startTime = dayjs();
	await seedSandboxScript(client);

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
	console.log(`  Custom Events: ${whiskeyStats.eventCount + placeStats.eventCount}`);
	console.log(
		`  Media Entities: ${mediaStats.entityCount} (${(mediaStats.entityCount / 11) | 0}+ per type across 11 schemas)`,
	);
	console.log(`  Media Events: ${mediaStats.eventCount} (backlog, progress, complete, review)`);
	console.log(`  Collections: ${collectionStats.collectionCount}`);
	console.log("  Sandbox Scripts: 1");
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
