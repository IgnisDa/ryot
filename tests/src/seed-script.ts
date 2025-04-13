import { faker } from "@faker-js/faker";
import type { components, paths } from "@ryot/generated/openapi/app-backend";
import createClient from "openapi-fetch";

const API_BASE_URL = "http://localhost:3000/api";
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
	throw new Error("API_KEY environment variable is not set");
}

type Client = ReturnType<typeof createClient<paths>>;
type CreateSavedViewBody = NonNullable<
	paths["/saved-views"]["post"]["requestBody"]
>["content"]["application/json"];
type SavedViewQueryDefinition = CreateSavedViewBody["queryDefinition"];
type SavedViewDisplayConfiguration =
	CreateSavedViewBody["displayConfiguration"];
type SavedViewTableColumn =
	SavedViewDisplayConfiguration["table"]["columns"][number];

type SavedViewSpec = {
	name: string;
	icon: string;
	trackerId?: string;
	accentColor: string;
	queryDefinition: SavedViewQueryDefinition;
	displayConfiguration: SavedViewDisplayConfiguration;
};

type PropertiesSchema = {
	fields: Record<string, components["schemas"]["AppPropertyDefinition"]>;
	rules?: components["schemas"]["AppSchemaRule"][];
};

class APIClient {
	private client: Client;
	private requestCount = 0;

	constructor() {
		this.client = createClient<paths>({
			baseUrl: API_BASE_URL,
			headers: { "X-Api-Key": API_KEY },
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
		body: { name, slug, trackerId, icon, accentColor, propertiesSchema },
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
		body: { name, slug, entitySchemaId, propertiesSchema },
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
	queryDefinition: SavedViewQueryDefinition,
	displayConfiguration: SavedViewDisplayConfiguration,
	trackerId?: string,
) {
	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { data, response } = await client.POST("/saved-views", {
		body: {
			name,
			icon,
			accentColor,
			trackerId,
			queryDefinition,
			displayConfiguration,
		},
	});

	if (!response.ok || !data?.data) {
		const details = data ? ` ${JSON.stringify(data)}` : "";
		throw new Error(
			`Failed to create saved view: ${response.status} ${response.statusText}${details}`,
		);
	}

	return data.data;
}

function propertyReference(...fields: string[]) {
	return fields;
}

function schemaField(schemaSlug: string, property: string) {
	return `${schemaSlug}.${property}`;
}

function cardConfig(
	imageProperty: string[] | null,
	titleProperty: string[] | null,
	badgeProperty: string[] | null,
	subtitleProperty: string[] | null,
): SavedViewDisplayConfiguration["grid"] {
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
): SavedViewQueryDefinition["sort"] {
	return { fields, direction };
}

function displayConfiguration(
	grid: SavedViewDisplayConfiguration["grid"],
	columns: SavedViewTableColumn[],
	list = grid,
): SavedViewDisplayConfiguration {
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
		date: faker.date.past({ years: 2 }).toISOString().split("T")[0],
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
				distillery: { type: "string", validation: { required: true } },
				age: { type: "integer" },
				region: { type: "string" },
				proof: { type: "number" },
				type: { type: "string" },
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
					validation: { required: true, maximum: 10, minimum: 1 },
				},
				notes: { type: "string" },
				location: { type: "string" },
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
				price: { type: "number", validation: { required: true } },
				store: { type: "string" },
				bottle_size: { type: "integer" },
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

	return { tracker, entityCount, eventCount: totalEvents };
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
				city: { type: "string", validation: { required: true } },
				country: { type: "string", validation: { required: true } },
				type: { type: "string" },
				address: { type: "string" },
				latitude: { type: "number" },
				longitude: { type: "number" },
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
				date: { type: "date", validation: { required: true } },
				duration_hours: { type: "number" },
				companions: { type: "string" },
				notes: { type: "string" },
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
					validation: { required: true, maximum: 5, minimum: 1 },
				},
				review: { type: "string" },
				would_return: { type: "boolean" },
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
				photo_url: { type: "string" },
				caption: { type: "string" },
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

	return { tracker, entityCount, eventCount: totalEvents };
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
				manufacturer: { type: "string", validation: { required: true } },
				year: { type: "integer" },
				os: { type: "string" },
				screen_size: { type: "number" },
				storage_gb: { type: "integer" },
				ram_gb: { type: "integer" },
				price_usd: { type: "number" },
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
				manufacturer: { type: "string", validation: { required: true } },
				year: { type: "integer" },
				has_camera: { type: "boolean" },
				battery_mah: { type: "integer" },
				color: { type: "string" },
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
				manufacturer: { type: "string", validation: { required: true } },
				year: { type: "integer" },
				screen_size: { type: "number" },
				os: { type: "string" },
				storage_gb: { type: "integer" },
				has_cellular: { type: "boolean" },
			},
		},
	);

	console.log("\n  Creating smartphone entities...");
	const smartphoneCount = randomInt(90, 110);
	for (let i = 0; i < smartphoneCount; i++) {
		const phone = generateSmartphone();
		await createEntity(
			client,
			phone.name,
			smartphoneSchema.id,
			phone.properties,
			generateImageUrl(phone.name, 400, 600),
		);

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
		await createEntity(
			client,
			phone.name,
			featurePhoneSchema.id,
			phone.properties,
			generateImageUrl(phone.name, 400, 600),
		);

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
		await createEntity(
			client,
			tablet.name,
			tabletSchema.id,
			tablet.properties,
			generateImageUrl(tablet.name, 400, 600),
		);

		if ((i + 1) % 10 === 0) {
			console.log(`    Progress: ${i + 1}/${tabletCount} tablets created`);
		}
	}
	console.log(`  ✓ Created ${tabletCount} tablets`);

	return {
		tracker,
		entityCount: smartphoneCount + featurePhoneCount + tabletCount,
		eventCount: 0,
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
						"smartphone.year",
						"feature-phone.year",
						"tablet.year",
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
				sort: sortDefinition("desc", "@updatedAt", "@name"),
			},
			displayConfiguration: displayConfiguration(
				cardConfig(
					propertyReference("@image"),
					propertyReference("@name"),
					propertyReference(
						"whiskey.age",
						"place.city",
						"smartphone.storage_gb",
						"feature-phone.battery_mah",
						"tablet.screen_size",
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
						"whiskey.age",
						"place.city",
						"smartphone.storage_gb",
						"feature-phone.battery_mah",
						"tablet.screen_size",
					),
					tableColumn("Updated", "@updatedAt"),
				],
			),
		},
	];

	const sections = [
		["whiskey-related", whiskeyViews],
		["place-related", placeViews],
		["phone-related", phoneViews],
		["cross-tracker", crossTrackerViews],
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

	console.log("✓ API Key validated");
	console.log(`✓ API Base URL: ${API_BASE_URL}`);

	const client = new APIClient();
	const startTime = Date.now();

	const whiskeyStats = await seedWhiskeys(client);
	const placeStats = await seedPlaces(client);
	const phoneStats = await seedMobilePhones(client);
	const savedViewsCount = await seedSavedViews(
		client,
		whiskeyStats.tracker.id,
		placeStats.tracker.id,
		phoneStats.tracker.id,
	);

	const duration = Math.floor((Date.now() - startTime) / 1000);
	const minutes = Math.floor(duration / 60);
	const seconds = duration % 60;

	console.log(`\n${"━".repeat(50)}`);
	console.log("📊 Summary:");
	console.log("  Trackers: 3");
	console.log("  Entity Schemas: 5 (1 whiskey + 1 place + 3 phones)");
	console.log("  Event Schemas: 5 (2 whiskey + 3 place)");
	console.log(
		`  Entities: ${whiskeyStats.entityCount + placeStats.entityCount + phoneStats.entityCount}`,
	);
	console.log(`  Events: ${whiskeyStats.eventCount + placeStats.eventCount}`);
	console.log(`  Saved Views: ${savedViewsCount}`);
	console.log(`  API Requests: ${client.getRequestCount()}`);
	console.log(`  Duration: ${minutes}m ${seconds}s`);
	console.log("━".repeat(50));
	console.log("✅ Seed completed successfully!");
}

main().catch((error) => {
	console.error("\n❌ Seed failed:");
	console.error(error);
	process.exit(1);
});
