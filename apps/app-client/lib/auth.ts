import { apiKeyClient } from "@better-auth/api-key/client";
import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { atom } from "jotai";
import { Platform } from "react-native";
import { CLOUD_URL, serverUrlAtom } from "./atoms";

const nativeStorage = {
	getItem: (key: string) => SecureStore.getItem(key),
	setItem: (key: string, value: string) => SecureStore.setItem(key, value),
};

export const authClientAtom = atom((get) => {
	const serverUrl = (get(serverUrlAtom) ?? CLOUD_URL) as string;
	const plugins =
		Platform.OS !== "web"
			? [
					expoClient({
						scheme: "ryot",
						storagePrefix: "ryot",
						storage: nativeStorage,
					}),
					apiKeyClient(),
				]
			: [apiKeyClient()];
	return createAuthClient({ baseURL: serverUrl, plugins });
});

export type AuthClient = ReturnType<typeof createAuthClient>;
