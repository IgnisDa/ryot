import type { paths } from "@ryot/generated/openapi/app-backend";
import type createClient from "openapi-fetch";
import { getBackendClient, getBackendUrl } from "./setup";

export type Client = ReturnType<typeof createClient<paths>>;

export interface CreateTrackerOptions {
	icon?: string;
	name?: string;
	slug?: string;
	enabled?: boolean;
	accentColor?: string;
	description?: string;
}

export async function createTracker(
	client: Client,
	cookies: string,
	options: CreateTrackerOptions = {},
) {
	const {
		enabled = true,
		icon = "rocket",
		name = "Test Tracker",
		accentColor = "#FF5733",
		slug = `tracker-${crypto.randomUUID()}`,
		description = "Test tracker description",
	} = options;

	const { data, response } = await client.POST("/trackers", {
		headers: { Cookie: cookies },
		body: { icon, name, slug, enabled, accentColor, description },
	});

	if (response.status !== 200 || !data?.data?.id) {
		throw new Error(`Failed to create tracker '${name}'`);
	}

	return { trackerId: data.data.id, data: data.data };
}

export interface CreateEntitySchemaOptions {
	icon?: string;
	name?: string;
	slug?: string;
	trackerId: string;
	accentColor?: string;
	propertiesSchema?: Record<
		string,
		{ type: "boolean" | "date" | "integer" | "number" | "string" }
	>;
}

export async function createEntitySchema(
	client: Client,
	cookies: string,
	options: CreateEntitySchemaOptions,
) {
	const {
		trackerId,
		icon = "book",
		name = "Test Schema",
		accentColor = "#00FF00",
		slug = `schema-${crypto.randomUUID()}`,
		propertiesSchema = { title: { type: "string" as const } },
	} = options;

	const { data, response } = await client.POST("/entity-schemas", {
		headers: { Cookie: cookies },
		body: { icon, name, slug, trackerId, accentColor, propertiesSchema },
	});

	if (response.status !== 200 || !data?.data?.id || !data.data.slug) {
		throw new Error(`Failed to create entity schema '${name}'`);
	}

	return { schemaId: data.data.id, slug: data.data.slug, data: data.data };
}

export async function createTestUser() {
	const password = "password123";
	const baseUrl = getBackendUrl();
	const email = `test-${Date.now()}@example.com`;

	const signUpResponse = await fetch(`${baseUrl}/authentication/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, name: "Test User", password }),
	});

	if (!signUpResponse.ok) {
		const error = await signUpResponse.text();
		throw new Error(`Sign up failed: ${error}`);
	}

	const signInResponse = await fetch(`${baseUrl}/auth/sign-in/email`, {
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
		throw new Error("Failed to get auth cookies");
	}

	return { cookies, email, password };
}

export const emptyDisplayConfiguration = {
	table: { columns: [] },
	layout: "grid" as const,
	grid: {
		imageProperty: null,
		titleProperty: null,
		badgeProperty: null,
		subtitleProperty: null,
	},
	list: {
		imageProperty: null,
		titleProperty: null,
		badgeProperty: null,
		subtitleProperty: null,
	},
};

export const basicQueryDefinition = {
	filters: [],
	entitySchemaSlugs: ["book"],
	sort: { direction: "asc" as const, field: ["name"] },
};

export async function createAuthenticatedClient() {
	const client = getBackendClient();
	const { cookies, email, password } = await createTestUser();
	return { client, cookies, email, password };
}
