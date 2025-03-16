// delete this file eventually
import { faker } from "@faker-js/faker";
import type { paths } from "@ryot/generated/openapi/app-backend";
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

type PropertiesSchema = Record<
	string,
	{
		type: "string" | "number" | "integer" | "boolean" | "date";
		required?: true;
	}
>;

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

async function createEvent(
	apiClient: APIClient,
	entityId: string,
	eventSchemaId: string,
	properties: Record<string, unknown>,
	occurredAt: string,
): Promise<void> {
	apiClient.incrementRequestCount();
	const client = apiClient.getClient();
	const { response } = await client.POST("/events", {
		body: { entityId, occurredAt, properties, eventSchemaId },
	});

	if (!response.ok) {
		throw new Error(`Failed to create event: ${response.statusText}`);
	}
}

async function createSavedView(
	apiClient: APIClient,
	name: string,
	icon: string,
	accentColor: string,
	queryDefinition: unknown,
	displayConfiguration: unknown,
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
			queryDefinition:
				queryDefinition as CreateSavedViewBody["queryDefinition"],
			displayConfiguration:
				displayConfiguration as CreateSavedViewBody["displayConfiguration"],
		},
	});

	if (!response.ok || !data?.data) {
		throw new Error(`Failed to create saved view: ${response.statusText}`);
	}

	return data.data;
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
			distillery: { type: "string", required: true },
			age: { type: "integer" },
			region: { type: "string" },
			proof: { type: "number" },
			type: { type: "string" },
		},
	);

	const tastingSchema = await createEventSchema(
		client,
		"Tasting",
		"tasting",
		entitySchema.id,
		{
			rating: { type: "integer", required: true },
			notes: { type: "string" },
			location: { type: "string" },
		},
	);

	const purchaseSchema = await createEventSchema(
		client,
		"Purchase",
		"purchase",
		entitySchema.id,
		{
			price: { type: "number", required: true },
			store: { type: "string" },
			bottle_size: { type: "integer" },
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
	let totalEvents = 0;
	for (const entity of entities) {
		const eventCount = randomInt(3, 100);
		const eventSchemas = [tastingSchema, purchaseSchema];

		for (let i = 0; i < eventCount; i++) {
			const schema = randomChoice(eventSchemas);
			const properties =
				schema.id === tastingSchema.id
					? generateWhiskeyTasting()
					: generateWhiskeyPurchase();

			await createEvent(
				client,
				entity.id,
				schema.id,
				properties,
				faker.date.past({ years: 2 }).toISOString(),
			);
			totalEvents++;

			if (totalEvents % 1000 === 0) {
				console.log(`    Progress: ${totalEvents} events created`);
			}
		}
	}
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
			city: { type: "string", required: true },
			country: { type: "string", required: true },
			type: { type: "string" },
			address: { type: "string" },
			latitude: { type: "number" },
			longitude: { type: "number" },
		},
	);

	const visitSchema = await createEventSchema(
		client,
		"Visit",
		"visit",
		entitySchema.id,
		{
			date: { type: "date", required: true },
			duration_hours: { type: "number" },
			companions: { type: "string" },
			notes: { type: "string" },
		},
	);

	const ratingSchema = await createEventSchema(
		client,
		"Rating",
		"rating",
		entitySchema.id,
		{
			rating: { type: "integer", required: true },
			review: { type: "string" },
			would_return: { type: "boolean" },
		},
	);

	const photoSchema = await createEventSchema(
		client,
		"Photo",
		"photo",
		entitySchema.id,
		{
			photo_url: { type: "string" },
			caption: { type: "string" },
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
	let totalEvents = 0;
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

			await createEvent(
				client,
				entity.id,
				schema.id,
				properties,
				faker.date.past({ years: 2 }).toISOString(),
			);
			totalEvents++;

			if (totalEvents % 1000 === 0) {
				console.log(`    Progress: ${totalEvents} events created`);
			}
		}
	}
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
			manufacturer: { type: "string", required: true },
			year: { type: "integer" },
			os: { type: "string" },
			screen_size: { type: "number" },
			storage_gb: { type: "integer" },
			ram_gb: { type: "integer" },
			price_usd: { type: "number" },
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
			manufacturer: { type: "string", required: true },
			year: { type: "integer" },
			has_camera: { type: "boolean" },
			battery_mah: { type: "integer" },
			color: { type: "string" },
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
			manufacturer: { type: "string", required: true },
			year: { type: "integer" },
			screen_size: { type: "number" },
			os: { type: "string" },
			storage_gb: { type: "integer" },
			has_cellular: { type: "boolean" },
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

	console.log("  Creating whiskey-related saved views...");
	savedViews.push(
		await createSavedView(
			client,
			"Premium Aged Whiskeys",
			"wine",
			"#D97706",
			{
				filters: [{ op: "gte", field: "age", value: 18 }],
				entitySchemaSlugs: ["whiskey"],
				sort: { fields: "age", direction: "desc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["age"],
					subtitleProperty: ["distillery"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["age"],
					subtitleProperty: ["distillery"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["age"] },
						{ property: ["distillery"] },
						{ property: ["proof"] },
					],
				},
			},
			whiskeyTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Scotch Whiskeys",
			"wine",
			"#B45309",
			{
				filters: [{ op: "eq", field: "type", value: "Scotch" }],
				entitySchemaSlugs: ["whiskey"],
				sort: { fields: "@name", direction: "asc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["type"],
					subtitleProperty: ["region"],
				},
				table: {
					columns: [
						{ label: "Name", property: ["@name"] },
						{ label: "Region", property: ["region"] },
					],
				},
			},
			whiskeyTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"High Proof Whiskeys",
			"flame",
			"#DC2626",
			{
				filters: [{ op: "gte", field: "proof", value: 100 }],
				entitySchemaSlugs: ["whiskey"],
				sort: { fields: "proof", direction: "desc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["proof"],
					subtitleProperty: ["type"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["proof"] },
						{ property: ["type"] },
						{ property: ["age"] },
					],
				},
			},
			whiskeyTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Recent Whiskey Additions",
			"clock",
			"#F59E0B",
			{
				filters: [],
				entitySchemaSlugs: ["whiskey"],
				sort: { fields: "@createdAt", direction: "desc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["type"],
					subtitleProperty: ["distillery"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["type"],
					subtitleProperty: ["distillery"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["@createdAt"] },
						{ property: ["type"] },
					],
				},
			},
			whiskeyTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Japanese Whiskeys",
			"wine",
			"#DC2626",
			{
				filters: [{ op: "eq", field: "type", value: "Japanese" }],
				entitySchemaSlugs: ["whiskey"],
				sort: { fields: "age", direction: "desc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["age"],
					subtitleProperty: ["distillery"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["age"],
					subtitleProperty: ["distillery"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["age"] },
						{ property: ["distillery"] },
					],
				},
			},
			whiskeyTrackerId,
		),
	);

	console.log("  Creating place-related saved views...");
	savedViews.push(
		await createSavedView(
			client,
			"Restaurants & Cafes",
			"utensils",
			"#EF4444",
			{
				filters: [{ op: "in", field: "type", value: ["Restaurant", "Cafe"] }],
				entitySchemaSlugs: ["place"],
				sort: { fields: "@name", direction: "asc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["type"],
					subtitleProperty: ["city"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["type"] },
						{ property: ["city"] },
					],
				},
			},
			placesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Cultural Venues",
			"landmark",
			"#8B5CF6",
			{
				filters: [
					{
						op: "in",
						field: "type",
						value: ["Museum", "Gallery", "Theater"],
					},
				],
				entitySchemaSlugs: ["place"],
				sort: { fields: "city", direction: "asc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["type"],
					subtitleProperty: ["country"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["type"],
					subtitleProperty: ["country"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["type"] },
						{ property: ["city"] },
						{ property: ["country"] },
					],
				},
			},
			placesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Parks & Outdoor Spaces",
			"tree",
			"#10B981",
			{
				filters: [{ op: "eq", field: "type", value: "Park" }],
				entitySchemaSlugs: ["place"],
				sort: { fields: "@name", direction: "asc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["city"],
					subtitleProperty: ["country"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["city"],
					subtitleProperty: ["country"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["city"] },
						{ property: ["address"] },
					],
				},
			},
			placesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Recently Added Places",
			"clock",
			"#3B82F6",
			{
				filters: [],
				entitySchemaSlugs: ["place"],
				sort: { fields: "@createdAt", direction: "desc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["type"],
					subtitleProperty: ["city"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["@createdAt"] },
						{ property: ["type"] },
					],
				},
			},
			placesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Places by Country",
			"globe",
			"#06B6D4",
			{
				filters: [],
				entitySchemaSlugs: ["place"],
				sort: { fields: "country", direction: "asc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["country"],
					subtitleProperty: ["city"],
				},
				table: {
					columns: [
						{ property: ["country"] },
						{ property: ["city"] },
						{ property: ["@name"] },
						{ property: ["type"] },
					],
				},
			},
			placesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Cultural Venues",
			"landmark",
			"#8B5CF6",
			{
				filters: [
					{
						op: "in",
						field: "type",
						value: ["Museum", "Gallery", "Theater"],
					},
				],
				entitySchemaSlugs: ["place"],
				sort: { fields: "city", direction: "asc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["type"],
					subtitleProperty: ["country"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["type"],
					subtitleProperty: ["country"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["type"] },
						{ property: ["city"] },
						{ property: ["country"] },
					],
				},
			},
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Parks & Outdoor Spaces",
			"tree",
			"#10B981",
			{
				filters: [{ op: "eq", field: "type", value: "Park" }],
				entitySchemaSlugs: ["place"],
				sort: { fields: "@name", direction: "asc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["city"],
					subtitleProperty: ["country"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["city"],
					subtitleProperty: ["country"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["city"] },
						{ property: ["address"] },
					],
				},
			},
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Recently Added Places",
			"clock",
			"#3B82F6",
			{
				filters: [],
				entitySchemaSlugs: ["place"],
				sort: { fields: "@createdAt", direction: "desc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["type"],
					subtitleProperty: ["city"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["@createdAt"] },
						{ property: ["type"] },
					],
				},
			},
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Places by Country",
			"globe",
			"#06B6D4",
			{
				filters: [],
				entitySchemaSlugs: ["place"],
				sort: { fields: "country", direction: "asc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["country"],
					subtitleProperty: ["city"],
				},
				table: {
					columns: [
						{ property: ["country"] },
						{ property: ["city"] },
						{ property: ["@name"] },
						{ property: ["type"] },
					],
				},
			},
		),
	);

	console.log("  Creating phone-related saved views...");
	savedViews.push(
		await createSavedView(
			client,
			"Modern Smartphones",
			"smartphone",
			"#6366F1",
			{
				filters: [{ op: "gte", field: "year", value: 2020 }],
				entitySchemaSlugs: ["smartphone"],
				sort: { fields: "year", direction: "desc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["year"],
					subtitleProperty: ["manufacturer"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["year"],
					subtitleProperty: ["manufacturer"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["manufacturer"] },
						{ property: ["year"] },
						{ property: ["os"] },
					],
				},
			},
			phonesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"High Storage Devices",
			"hard-drive",
			"#EC4899",
			{
				filters: [{ op: "gte", field: "storage_gb", value: 256 }],
				entitySchemaSlugs: ["smartphone", "tablet"],
				sort: { fields: "storage_gb", direction: "desc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["storage_gb"],
					subtitleProperty: ["manufacturer"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["storage_gb"] },
						{ property: ["manufacturer"] },
						{ property: ["year"] },
					],
				},
			},
			phonesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"iOS Devices",
			"apple",
			"#6B7280",
			{
				filters: [{ op: "in", field: "os", value: ["iOS", "iPadOS"] }],
				entitySchemaSlugs: ["smartphone", "tablet"],
				sort: { fields: "year", direction: "desc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["os"],
					subtitleProperty: ["year"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["os"] },
						{ property: ["year"] },
					],
				},
			},
			phonesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Android Devices",
			"android",
			"#22C55E",
			{
				filters: [{ op: "eq", field: "os", value: "Android" }],
				entitySchemaSlugs: ["smartphone", "tablet"],
				sort: { fields: "@name", direction: "asc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["manufacturer"],
					subtitleProperty: ["year"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["manufacturer"],
					subtitleProperty: ["year"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["manufacturer"] },
						{ property: ["year"] },
					],
				},
			},
			phonesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Premium Smartphones",
			"gem",
			"#A855F7",
			{
				filters: [{ op: "gte", field: "price_usd", value: 999 }],
				entitySchemaSlugs: ["smartphone"],
				sort: { fields: "price_usd", direction: "desc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["price_usd"],
					subtitleProperty: ["manufacturer"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["price_usd"] },
						{ property: ["manufacturer"] },
						{ property: ["storage_gb"] },
						{ property: ["ram_gb"] },
					],
				},
			},
			phonesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Budget-Friendly Phones",
			"dollar-sign",
			"#10B981",
			{
				filters: [{ op: "lte", field: "price_usd", value: 399 }],
				entitySchemaSlugs: ["smartphone"],
				sort: { fields: "price_usd", direction: "asc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["price_usd"],
					subtitleProperty: ["manufacturer"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["price_usd"] },
						{ property: ["manufacturer"] },
					],
				},
			},
			phonesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Tablets with Cellular",
			"signal",
			"#F97316",
			{
				filters: [{ op: "eq", field: "has_cellular", value: true }],
				entitySchemaSlugs: ["tablet"],
				sort: { fields: "screen_size", direction: "desc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["screen_size"],
					subtitleProperty: ["manufacturer"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["screen_size"],
					subtitleProperty: ["manufacturer"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["screen_size"] },
						{ property: ["manufacturer"] },
						{ property: ["storage_gb"] },
					],
				},
			},
			phonesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Feature Phones with Camera",
			"camera",
			"#84CC16",
			{
				filters: [{ op: "eq", field: "has_camera", value: true }],
				entitySchemaSlugs: ["feature-phone"],
				sort: { fields: "year", direction: "desc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["year"],
					subtitleProperty: ["manufacturer"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["manufacturer"] },
						{ property: ["year"] },
						{ property: ["battery_mah"] },
					],
				},
			},
			phonesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"All Mobile Devices",
			"mobile-phone",
			"#475569",
			{
				filters: [],
				entitySchemaSlugs: ["smartphone", "feature-phone", "tablet"],
				sort: { fields: "@name", direction: "asc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["manufacturer"],
					subtitleProperty: ["year"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["manufacturer"],
					subtitleProperty: ["year"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["manufacturer"] },
						{ property: ["year"] },
					],
				},
			},
			phonesTrackerId,
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"High Storage Devices",
			"hard-drive",
			"#EC4899",
			{
				filters: [{ op: "gte", field: "storage_gb", value: 256 }],
				entitySchemaSlugs: ["smartphone", "tablet"],
				sort: { fields: "storage_gb", direction: "desc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["storage_gb"],
					subtitleProperty: ["manufacturer"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["storage_gb"] },
						{ property: ["manufacturer"] },
						{ property: ["year"] },
					],
				},
			},
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"iOS Devices",
			"apple",
			"#6B7280",
			{
				filters: [{ op: "in", field: "os", value: ["iOS", "iPadOS"] }],
				entitySchemaSlugs: ["smartphone", "tablet"],
				sort: { fields: "year", direction: "desc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["os"],
					subtitleProperty: ["year"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["os"] },
						{ property: ["year"] },
					],
				},
			},
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Android Devices",
			"android",
			"#22C55E",
			{
				filters: [{ op: "eq", field: "os", value: "Android" }],
				entitySchemaSlugs: ["smartphone", "tablet"],
				sort: { fields: "@name", direction: "asc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["manufacturer"],
					subtitleProperty: ["year"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["manufacturer"],
					subtitleProperty: ["year"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["manufacturer"] },
						{ property: ["year"] },
					],
				},
			},
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Premium Smartphones",
			"gem",
			"#A855F7",
			{
				filters: [{ op: "gte", field: "price_usd", value: 999 }],
				entitySchemaSlugs: ["smartphone"],
				sort: { fields: "price_usd", direction: "desc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["price_usd"],
					subtitleProperty: ["manufacturer"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["price_usd"] },
						{ property: ["manufacturer"] },
						{ property: ["storage_gb"] },
						{ property: ["ram_gb"] },
					],
				},
			},
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Budget-Friendly Phones",
			"dollar-sign",
			"#10B981",
			{
				filters: [{ op: "lte", field: "price_usd", value: 399 }],
				entitySchemaSlugs: ["smartphone"],
				sort: { fields: "price_usd", direction: "asc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["price_usd"],
					subtitleProperty: ["manufacturer"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["price_usd"] },
						{ property: ["manufacturer"] },
					],
				},
			},
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Tablets with Cellular",
			"signal",
			"#F97316",
			{
				filters: [{ op: "eq", field: "has_cellular", value: true }],
				entitySchemaSlugs: ["tablet"],
				sort: { fields: "screen_size", direction: "desc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["screen_size"],
					subtitleProperty: ["manufacturer"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["screen_size"],
					subtitleProperty: ["manufacturer"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["screen_size"] },
						{ property: ["manufacturer"] },
						{ property: ["storage_gb"] },
					],
				},
			},
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"Feature Phones with Camera",
			"camera",
			"#84CC16",
			{
				filters: [{ op: "eq", field: "has_camera", value: true }],
				entitySchemaSlugs: ["feature-phone"],
				sort: { fields: "year", direction: "desc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["year"],
					subtitleProperty: ["manufacturer"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["manufacturer"] },
						{ property: ["year"] },
						{ property: ["battery_mah"] },
					],
				},
			},
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"All Mobile Devices",
			"mobile-phone",
			"#475569",
			{
				filters: [],
				entitySchemaSlugs: ["smartphone", "feature-phone", "tablet"],
				sort: { fields: "@name", direction: "asc" },
			},
			{
				grid: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["manufacturer"],
					subtitleProperty: ["year"],
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: ["manufacturer"],
					subtitleProperty: ["year"],
				},
				table: {
					columns: [
						{ property: ["@name"] },
						{ property: ["manufacturer"] },
						{ property: ["year"] },
					],
				},
			},
		),
	);

	console.log("  Creating cross-tracker saved views...");
	savedViews.push(
		await createSavedView(
			client,
			"Everything Recently Added",
			"star",
			"#FFD700",
			{
				filters: [],
				entitySchemaSlugs: [
					"whiskey",
					"place",
					"smartphone",
					"feature-phone",
					"tablet",
				],
				sort: { fields: "@createdAt", direction: "desc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: null,
					subtitleProperty: null,
				},
				table: {
					columns: [
						{ label: "Name", property: ["@name"] },
						{ label: "Created", property: ["@createdAt"] },
					],
				},
			},
		),
	);

	savedViews.push(
		await createSavedView(
			client,
			"All Items A-Z",
			"book",
			"#1F2937",
			{
				filters: [],
				entitySchemaSlugs: [
					"whiskey",
					"place",
					"smartphone",
					"feature-phone",
					"tablet",
				],
				sort: { fields: "@name", direction: "asc" },
			},
			{
				grid: {
					imageProperty: null,
					titleProperty: null,
					badgeProperty: null,
					subtitleProperty: null,
				},
				list: {
					imageProperty: ["@image"],
					titleProperty: ["@name"],
					badgeProperty: null,
					subtitleProperty: null,
				},
				table: {
					columns: [{ label: "Name", property: ["@name"] }],
				},
			},
		),
	);

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
