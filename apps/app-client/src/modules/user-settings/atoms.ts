import { Atom } from "effect/unstable/reactivity";

import { appClient } from "@/api/client";
import { type ApiScope, canonicalApiScope, scopedReactivityKey } from "@/api/request-key";

const settingsKeys = (scope: ApiScope) => scopedReactivityKey("user-settings", scope);

const userSettingsFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).query("userSettings", "get", {
		reactivityKeys: settingsKeys(scope),
	}),
);

const updateUserPreferencesFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).mutation("userSettings", "updatePreferences"),
);

const refreshUserAvatarFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).mutation("userSettings", "refreshAvatar"),
);

export const userSettingsAtom = (scope: ApiScope) => userSettingsFamily(canonicalApiScope(scope));

export const updateUserPreferencesAtom = (scope: ApiScope) =>
	updateUserPreferencesFamily(canonicalApiScope(scope));

export const refreshUserAvatarAtom = (scope: ApiScope) =>
	refreshUserAvatarFamily(canonicalApiScope(scope));

export const userSettingsReactivityKeys = settingsKeys;
