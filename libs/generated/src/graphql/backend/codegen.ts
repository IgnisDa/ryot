import { join } from "node:path";
import type { CodegenConfig } from "@graphql-codegen/cli";

import { definitionsLibraryPath } from "..";

const config: CodegenConfig = {
	config: {
		scalars: {
			UUID: "string",
			DateTime: "Date",
		},
	},
	documents: [join(definitionsLibraryPath, "backend/{queries,mutations}.ts")],
	generates: {
		"./src/graphql/backend/": {
			config: { skipTypename: true },
			plugins: [],
			preset: "client",
		},
	},
	ignoreNoDocuments: true,
	overwrite: true,
	schema: "http://127.0.0.1:8000/graphql",
};

export default config;
