import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { serverStorageRuntime } from "@/modules/server/storage";

const themeSchema = Schema.Literals(["light", "dark", "system"]);

export const themeAtom = Atom.kvs({
	key: "theme",
	schema: themeSchema,
	runtime: serverStorageRuntime,
	defaultValue: () => "system" as const,
});
