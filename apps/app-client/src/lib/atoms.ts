import { apiKeyClient } from "@better-auth/api-key/client";
import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";

export const CLOUD_URL = "https://app.ryot.io";

const mmkv = Platform.OS !== "web" ? createMMKV() : null;

export const atomWithPlatformStorage = <T>(key: string, initial: T) => {
	const storage = mmkv
		? createJSONStorage<T>(() => ({
				removeItem: (k: string) => mmkv.remove(k),
				getItem: (k: string) => mmkv.getString(k) ?? null,
				setItem: (k: string, v: string) => mmkv.set(k, v),
				subscribe: (k: string, cb: (v: string | null) => void) => {
					const { remove } = mmkv.addOnValueChangedListener((changed) => {
						if (changed === k) {
							cb(mmkv.getString(k) ?? null);
						}
					});
					return remove;
				},
			}))
		: createJSONStorage<T>(() => localStorage);
	return atomWithStorage<T>(key, initial, storage, { getOnInit: true });
};

const serverUrlAtom = atomWithPlatformStorage<string | null>(
	"server-url",
	null,
);

export const useServerUrl = () => useAtomValue(serverUrlAtom);
export const useSetServerUrl = () => useSetAtom(serverUrlAtom);

const nativeStorage = {
	getItem: (key: string) => SecureStore.getItem(key),
	setItem: (key: string, value: string) => SecureStore.setItem(key, value),
};

const authClientAtom = atom((get) => {
	const serverUrl = (get(serverUrlAtom) ?? CLOUD_URL) as string;
	const plugins =
		Platform.OS !== "web"
			? [
					expoClient({ storagePrefix: "ryot", storage: nativeStorage }),
					apiKeyClient(),
				]
			: [apiKeyClient()];
	return createAuthClient({ baseURL: serverUrl, plugins });
});

export type AuthClient = ReturnType<typeof createAuthClient>;

export const useAuthClient = () => useAtomValue(authClientAtom);

export function useUser() {
	const authClient = useAuthClient();
	const { data: session } = authClient.useSession();
	return session?.user ?? null;
}
