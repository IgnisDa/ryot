import { expoClient } from "@better-auth/expo/client";
import { genericOAuthClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const storagePrefix = "ryot";
const cookieKey = `${storagePrefix}_cookie`;
const sessionKey = `${storagePrefix}_session_data`;

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

export async function clearAuthStorage() {
	await Promise.all([
		Promise.resolve(storage.setItem(cookieKey, "{}")),
		Promise.resolve(storage.setItem(sessionKey, "null")),
	]);
}
