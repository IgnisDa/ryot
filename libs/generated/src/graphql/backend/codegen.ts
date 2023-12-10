import { join } from "node:path";
import type { CodegenConfig } from "@graphql-codegen/cli";

import { definitionsLibraryPath } from "..";

const config: CodegenConfig = {
	config: {
		scalars: {
			UUID: "string",
			DateTime: "string",
			NaiveDate: "string",
			Decimal: "string",
		},
	},
	documents: [
		join(definitionsLibraryPath, "backend/{queries,mutations}/*.gql"),
	],
	generates: {
		"./src/graphql/backend/": {
			config: { skipTypename: true },
			plugins: [],
			preset: "client",
			presetConfig: {
				fragmentMasking: false,
			},
		},
	},
	ignoreNoDocuments: true,
	overwrite: true,
	schema: "http://127.0.0.1:5000/graphql",
};

export default config;
