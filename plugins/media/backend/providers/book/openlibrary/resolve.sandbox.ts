import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { resolve } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "OpenLibrary Resolve",
	slug: "book.openlibrary.resolve",
});

export default defineProvider({ manifest, run: resolve.run, operation: "resolve" });
