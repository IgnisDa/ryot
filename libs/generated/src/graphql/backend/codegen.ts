import { join } from "node:path";
import type { CodegenConfig } from "@graphql-codegen/cli";
import { definitionsLibraryPath } from "..";

const config: CodegenConfig = {
	overwrite: true,
	ignoreNoDocuments: true,
	schema: "http://127.0.0.1:5000/graphql",
	documents: [
		join(definitionsLibraryPath, "backend/{queries,mutations}/*.gql"),
	],
	config: {
		scalars: {
			UUID: "string",
			Decimal: "string",
			DateTime: "string",
			NaiveDate: "string",
		},
	},
	generates: {
		"./src/graphql/backend/": {
			plugins: [],
			preset: "client",
			config: { skipTypename: true },
			presetConfig: { fragmentMasking: false },
		},
	},
};

export default config;
