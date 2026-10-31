import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, it } from "node:test";

const root = join(import.meta.dirname, "../..");
const { overrides } = JSON.parse(readFileSync(join(root, ".oxlintrc.json"), "utf8"));
const workspace = mkdtempSync(join(tmpdir(), "ryot-import-boundaries-"));

const fixtures = {
	"plugins/media/shared/allowed.test.ts": ["@ryot-app/plugin-backend-sdk/core"],
	"kernel/sandbox/src/host/allowed.ts": ["@ryot-app/plugin-backend-sdk/core", "../protocol/wire"],
	"plugins/media/shared/restricted.ts": ["@ryot-app/plugin-backend-sdk/core", "../manifest/plugin"],
	"plugins/media/manifest/allowed.test.ts": [
		"@ryot-app/kernel-backend/modules/scripts/plugin-load.test-support",
	],
	"kernel/backend/src/platform/workflow/allowed.ts": [
		"@ryot-app/contract/modules/scripts/wire",
		"../database/session",
	],
	"plugins/media/manifest/restricted.ts": [
		"@ryot-app/kernel-backend/modules/scripts/plugin-load.test-support",
		"../backend/scripts/search",
	],
	"kernel/backend/src/platform/workflow/restricted.ts": [
		"#modules/entities/service",
		"#boot/layers",
		"../../modules/entities/service",
		"../../boot/layers",
	],
	"kernel/sandbox/src/host/restricted.ts": [
		"@ryot-app/kernel-backend/modules/scripts/executions/service",
		"../../../backend/src/modules/scripts/executions/service",
	],
};

writeFileSync(
	join(workspace, ".oxlintrc.json"),
	JSON.stringify({
		overrides: overrides.filter(
			(override) => !Object.keys(override.rules).some((rule) => rule.startsWith("ryot/")),
		),
	}),
);
for (const [file, specifiers] of Object.entries(fixtures)) {
	mkdirSync(join(workspace, dirname(file)), { recursive: true });
	writeFileSync(
		join(workspace, file),
		specifiers.map((specifier) => `import "${specifier}";\n`).join(""),
	);
}

after(() => rmSync(workspace, { force: true, recursive: true }));

it("restricts every spelling of a boundary crossing outside tests", () => {
	const { stdout } = spawnSync(join(root, "node_modules/.bin/oxlint"), ["-f", "json", "."], {
		cwd: workspace,
		encoding: "utf8",
	});
	const restricted = JSON.parse(stdout)
		.diagnostics.map(
			(diagnostic) => `${diagnostic.filename}: ${diagnostic.message.match(/'(.+)'/)[1]}`,
		)
		.toSorted();
	const expected = Object.entries(fixtures)
		.filter(([file]) => file.endsWith("/restricted.ts"))
		.flatMap(([file, specifiers]) => specifiers.map((specifier) => `${file}: ${specifier}`))
		.toSorted();
	assert.deepEqual(restricted, expected);
});
