import { fileURLToPath } from "node:url";

const registry = {
	"bun-services": fileURLToPath(new URL("./transforms/bun-services.ts", import.meta.url)),
	"core-renames": fileURLToPath(new URL("./transforms/core-renames.ts", import.meta.url)),
	"core-structural": fileURLToPath(new URL("./transforms/core-structural.ts", import.meta.url)),
	"import-relocation": fileURLToPath(new URL("./transforms/import-relocation.ts", import.meta.url)),
	logger: fileURLToPath(new URL("./transforms/logger.ts", import.meta.url)),
	noop: fileURLToPath(new URL("./transforms/noop.ts", import.meta.url)),
	result: fileURLToPath(new URL("./transforms/result.ts", import.meta.url)),
	"runtime-context": fileURLToPath(new URL("./transforms/runtime-context.ts", import.meta.url)),
	"schema-annotations": fileURLToPath(
		new URL("./transforms/schema-annotations.ts", import.meta.url),
	),
	"schema-codecs": fileURLToPath(new URL("./transforms/schema-codecs.ts", import.meta.url)),
	"schema-checks": fileURLToPath(new URL("./transforms/schema-checks.ts", import.meta.url)),
	"schema-filters": fileURLToPath(new URL("./transforms/schema-filters.ts", import.meta.url)),
	"schema-constructors": fileURLToPath(
		new URL("./transforms/schema-constructors.ts", import.meta.url),
	),
	"schema-optionals": fileURLToPath(new URL("./transforms/schema-optionals.ts", import.meta.url)),
	"schema-transformations": fileURLToPath(
		new URL("./transforms/schema-transformations.ts", import.meta.url),
	),
	"schema-tagged-errors": fileURLToPath(
		new URL("./transforms/schema-tagged-errors.ts", import.meta.url),
	),
	services: fileURLToPath(new URL("./transforms/services.ts", import.meta.url)),
	vitest: fileURLToPath(new URL("./transforms/vitest.ts", import.meta.url)),
} as const;

export const getTransform = (name: string) => {
	if (!Object.hasOwn(registry, name)) {
		throw new Error(
			`Unknown transform "${name}". Registered transforms: ${Object.keys(registry).join(", ")}`,
		);
	}

	const transform = name as keyof typeof registry;
	return { name: transform, path: registry[transform] };
};
