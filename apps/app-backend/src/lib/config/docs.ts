import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { FieldMeta, GroupMeta } from "./builder";

type Tree = GroupMeta;
type FieldRow = { key: string; field: FieldMeta };

const collectFields = (
	node: Tree,
	level: number,
	lines: string[],
	path: readonly string[],
): void => {
	lines.push(`${"#".repeat(level)} ${node.description}\n`);

	const directFields: FieldRow[] = [];
	const childGroups: { key: string; group: Tree }[] = [];

	for (const [key, child] of Object.entries(node.children)) {
		if (child.kind === "field") {
			if (!child.hidden) {
				directFields.push({ field: child, key: [...path, key].join(".") });
			}
		} else {
			childGroups.push({ key, group: child });
		}
	}

	if (directFields.length > 0) {
		lines.push(
			"| App Config Key | Variable | Description | Required | Sensitive | Default |",
			"|---|---|---|---|---|---|",
			...directFields.map(
				({ field, key }) =>
					`| \`${key}\` | \`${field.envKey}\` | ${field.description} | ${field.required ? "Yes" : "No"} | ${field.sensitive ? "Yes" : "No"} | ${field.default !== undefined ? `\`${field.default}\`` : "—"} |`,
			),
			"",
		);
	}

	for (const child of childGroups) {
		collectFields(child.group, level + 1, lines, [...path, child.key]);
	}
};

const buildContent = (trees: Tree[]): string => {
	const lines: string[] = [
		"# App Backend Configuration Reference\n",
		"> This file is auto-generated on dev server startup. Do not edit manually.\n",
	];
	for (const tree of trees) {
		collectFields(tree, 2, lines, []);
	}
	return lines.join("\n");
};

export const generateConfigDocs = (trees: Tree[], outputPath: string) =>
	FileSystem.FileSystem.pipe(
		Effect.flatMap((fs) => fs.writeFileString(outputPath, buildContent(trees))),
	);
