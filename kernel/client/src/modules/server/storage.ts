import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { appStorageRuntime } from "@/persistence/storage";

const serverUrlKey = "server-url";
const serverUrlSchema = Schema.NullOr(Schema.String);

export const serverUrlAtom = Atom.kvs({
	key: serverUrlKey,
	schema: serverUrlSchema,
	defaultValue: () => null,
	runtime: appStorageRuntime,
});
