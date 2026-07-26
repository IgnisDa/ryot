import { expoClient } from "@better-auth/expo/client";
import { genericOAuthClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { normalizeServerOrigin } from "@/modules/server/url";

const storagePrefix = "ryot";
const cookieKey = `${storagePrefix}_cookie`;
const sessionKey = `${storagePrefix}_session_data`;

const removeWebValue = (key: string) => localStorage.removeItem(key);
const removeNativeValue = (key: string) => SecureStore.deleteItemAsync(key);

const storage =
	Platform.OS === "web"
		? {
				setItem: (key: string, value: string) => localStorage.setItem(key, value),
				getItem: (key: string) =>
					typeof localStorage === "undefined" ? null : localStorage.getItem(key),
			}
		: SecureStore;

const createClient = (baseURL: string) =>
	createAuthClient({
		baseURL,
		plugins: [
			expoClient({ scheme: "ryot", storage, storagePrefix }),
			genericOAuthClient(),
			twoFactorClient(),
		],
	});

type AuthClient = ReturnType<typeof createClient>;

const clients = new Map<string, AuthClient>();

const authStorageKeys = [cookieKey, sessionKey] as const;

async function removeAuthValue(key: string) {
	const storedValue = storage.getItem(key);
	const chunkCount = storedValue?.startsWith("\u0001ba-chunks:")
		? Number(storedValue.slice(11))
		: 0;
	const keys = [key, ...Array.from({ length: chunkCount }, (_, index) => `${key}.${index}`)];
	await Promise.all(
		keys.map(async (storageKey) => {
			await (Platform.OS === "web" ? removeWebValue(storageKey) : removeNativeValue(storageKey));
		}),
	);
}

export function getAuthClient(serverUrl: string) {
	const normalizedServerUrl = normalizeServerOrigin(serverUrl);
	const existing = clients.get(normalizedServerUrl);
	if (existing) {
		return existing;
	}

	const client = createClient(normalizedServerUrl);
	clients.set(normalizedServerUrl, client);
	return client;
}

export const getAuthCookie = (serverUrl: string) => getAuthClient(serverUrl).getCookie();

export async function clearAuthStorage() {
	try {
		await Promise.all(authStorageKeys.map(removeAuthValue));
	} finally {
		clients.clear();
	}
}
