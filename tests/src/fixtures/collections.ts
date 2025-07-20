import type { Client } from "./auth";

export interface CreateCollectionOptions {
	name?: string;
	description?: string;
	membershipPropertiesSchema?: Record<string, unknown>;
}

export async function createCollection(
	client: Client,
	cookies: string,
	options: CreateCollectionOptions = {},
) {
	const {
		name = `Test Collection ${crypto.randomUUID()}`,
		description = "A test collection",
		membershipPropertiesSchema,
	} = options;

	const { data, response } = await client.POST("/collections", {
		headers: { Cookie: cookies },
		body: { name, description, ...(membershipPropertiesSchema && { membershipPropertiesSchema }) },
	});

	if (response.status !== 200 || !data?.data.id) {
		throw new Error(`Failed to create collection '${name}'`);
	}

	return data.data;
}
