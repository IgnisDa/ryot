import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { appStorageRuntime } from "@/persistence/storage";

const themeSchema = Schema.Literals(["light", "dark", "system"]);

export type ThemePreference = Schema.Schema.Type<typeof themeSchema>;

export const themeAtom = Atom.kvs({
	key: "theme",
	schema: themeSchema,
	runtime: appStorageRuntime,
	defaultValue: () => "system" as const,
});
