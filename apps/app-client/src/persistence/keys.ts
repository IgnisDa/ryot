export const appStoragePrefix = "ryot:";

export const appStorageKey = (key: string) => `${appStoragePrefix}${key}`;

export const ownedAppStorageKeys = (keys: readonly string[]) =>
	keys.filter((key) => key.startsWith(appStoragePrefix));
