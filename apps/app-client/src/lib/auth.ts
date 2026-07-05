import { expoClient } from "@better-auth/expo/client";
import { genericOAuthClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { CLOUD_URL } from "@/lib/server";
import { useServerUrl } from "@/lib/store/server";

const STORAGE_PREFIX = "ryot";
const COOKIE_KEY = `${STORAGE_PREFIX}_cookie`;
const SESSION_KEY = `${STORAGE_PREFIX}_session_data`;

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
			expoClient({ scheme: "ryot", storage, storagePrefix: STORAGE_PREFIX }),
			genericOAuthClient(),
			twoFactorClient(),
		],
	});

export type AuthClient = ReturnType<typeof createClient>;

const clients = new Map<string, AuthClient>();

export function getAuthClient(serverUrl: string) {
	const existing = clients.get(serverUrl);
	if (existing) {
		return existing;
	}

	const client = createClient(serverUrl);
	clients.set(serverUrl, client);
	return client;
}

export const getAuthCookie = (serverUrl: string) => getAuthClient(serverUrl).getCookie();

export function useAuthClient() {
	return getAuthClient(useServerUrl() ?? CLOUD_URL);
}

export async function clearAuthStorage() {
	await Promise.all([
		Promise.resolve(storage.setItem(COOKIE_KEY, "{}")),
		Promise.resolve(storage.setItem(SESSION_KEY, "null")),
	]);
}
