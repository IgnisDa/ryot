import { getBackendClient, getBackendUrl } from "./setup";

export async function createTestUser() {
	const baseUrl = getBackendUrl();
	const timestamp = Date.now();
	const email = `test-${timestamp}@example.com`;
	const password = "password123";

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
