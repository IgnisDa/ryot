import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { normalizeServerOrigin, type ServerOrigin } from "../../api/origin";
import type { BrowserStorage } from "../../persistence/storage";

export const BETTER_AUTH_STORAGE_KEYS = ["better-auth.message"] as const;

const browserStorage = () => (typeof localStorage === "undefined" ? undefined : localStorage);

const createClient = (origin: ServerOrigin) =>
	createAuthClient({
		baseURL: origin,
		plugins: [twoFactorClient()],
		fetchOptions: { credentials: "include" },
	});

export type BrowserAuthClient = ReturnType<typeof createClient>;

const clients = new Map<ServerOrigin, BrowserAuthClient>();

export function getAuthClient(origin: ServerOrigin) {
	const normalized = normalizeServerOrigin(origin);
	const existing = clients.get(normalized);
	if (existing) {
		return existing;
	}

	const client = createClient(normalized);
	clients.set(normalized, client);
	return client;
}

export function clearAuthStorage(storage: BrowserStorage | undefined = browserStorage()) {
	for (const key of BETTER_AUTH_STORAGE_KEYS) {
		storage?.removeItem(key);
	}
	clients.clear();
}
