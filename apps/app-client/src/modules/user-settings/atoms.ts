import { appClient } from "@/api/client";
import type { ApiScope } from "@/api/request-key";
import { scopedReactivityKey } from "@/api/request-key";

const settingsKeys = (scope: ApiScope) => scopedReactivityKey("user-settings", scope);

export const userSettingsAtom = (scope: ApiScope) =>
	appClient(scope).query("userSettings", "get", {
		reactivityKeys: settingsKeys(scope),
	});

export const updateUserPreferencesAtom = (scope: ApiScope) =>
	appClient(scope).mutation("userSettings", "updatePreferences");

export const refreshUserAvatarAtom = (scope: ApiScope) =>
	appClient(scope).mutation("userSettings", "refreshAvatar");

export const userSettingsReactivityKeys = settingsKeys;
