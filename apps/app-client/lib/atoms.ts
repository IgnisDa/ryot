import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";

export const CLOUD_URL = "https://app.ryot.io";

const mmkv = Platform.OS !== "web" ? createMMKV() : null;

const nativeStorage = mmkv
	? createJSONStorage(() => ({
			getItem: (k: string) => mmkv.getString(k) ?? null,
			setItem: (k: string, v: string) => mmkv.set(k, v),
			removeItem: (k: string) => mmkv.remove(k),
			subscribe: (k: string, cb: (v: string | null) => void) => {
				const { remove } = mmkv.addOnValueChangedListener((changed) => {
					if (changed === k) {
						cb(mmkv.getString(k) ?? null);
					}
				});
				return remove;
			},
		}))
	: createJSONStorage(() => localStorage);

export const atomWithPlatformStorage = <T>(key: string, initial: T) =>
	atomWithStorage(key, initial, nativeStorage, { getOnInit: true });

export const serverUrlAtom = atomWithPlatformStorage<string | null>(
	"server-url",
	null,
);
