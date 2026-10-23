// TODO(https://github.com/oxc-project/oxc/issues/26740): Once the Bun RuleTester fix ships,
// upgrade Oxlint, verify this file with `bun test`, then replace the Node invocation in root `check`.
import { describe, it } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import plugin from "./ryot-plugin.mjs";

RuleTester.describe = (name, run) => {
	void describe(name, run);
};
RuleTester.it = (name, run) => {
	void it(name, run);
};
RuleTester.itOnly = (name, run) => {
	void it.only(name, run);
};

const ruleTester = new RuleTester({ languageOptions: { sourceType: "module" } });
const promiseChainError = { message: /do not chain \.then\/\.catch\/\.finally/ };

ruleTester.run("no-promise-chains", plugin.rules["no-promise-chains"], {
	invalid: [
		{ errors: [promiseChainError], code: "Promise.resolve(1).then(next);" },
		{ errors: [promiseChainError], code: "new Promise(resolve => resolve(1)).catch(recover);" },
		{
			errors: [promiseChainError],
			code: "const pending = Promise.resolve(1); pending.finally(cleanup);",
		},
		{
			errors: [promiseChainError],
			code: "const pending = Promise.resolve(1); const alias = pending; alias['then'](next);",
		},
		{ errors: [promiseChainError], code: "async function load() {} load().then(next);" },
		{
			errors: [promiseChainError],
			code: 'import { Effect as Fx } from "effect"; { const Fx = Promise.resolve(1); Fx["then"](next); }',
		},
		{
			errors: [promiseChainError],
			code: "const load = async () => 1; const pending = load(); pending.catch(recover);",
		},
		{ errors: [promiseChainError], code: "Promise['resolve'](1)['finally'](cleanup);" },
		{
			errors: [promiseChainError, promiseChainError],
			code: "Promise.resolve(1).then(next).catch(recover);",
		},
	],
	valid: [
		"const value = await promise;",
		"ordinary.catch(recover); unknown.then(next);",
		"const ordinary = { then() {}, toLayer() {} }; ordinary.then(next); ordinary.toLayer(run);",
		"let pending = Promise.resolve(1); pending = { then() {} }; pending.then(next);",
		'import { Effect as Fx } from "effect"; function run(Fx) { Fx.then(value, next); }',
		"const Promise = { resolve: () => ({ then() {} }) }; Promise.resolve().then(next);",
		"function run(Promise) { Promise.resolve().then(next); }",
		'import { Effect as Fx } from "effect"; Fx.catch(effect, recover);',
		'import { Effect as Fx } from "@ryot-app/plugin-client-sdk/effect"; Fx.finally(effect, cleanup);',
		'import { Effect as Fx } from "@ryot-app/plugin-backend-sdk/effect"; Fx.then(effect, next);',
		'import * as Fx from "effect/Effect"; Fx.catch(effect, recover);',
		'import * as Effects from "effect"; Effects.Effect.catch(effect, recover);',
		'import * as ClientSdk from "@ryot-app/plugin-client-sdk/effect"; ClientSdk.Effect.catch(effect, recover);',
		'import * as SandboxSdk from "@ryot-app/plugin-backend-sdk/effect"; SandboxSdk.Effect.finally(effect, cleanup);',
		'import { Effect as Fx } from "effect"; Fx["catch"](effect, recover);',
	],
});

ruleTester.run("no-workflow-to-layer", plugin.rules["no-workflow-to-layer"], {
	valid: [
		"const unrelated = { toLayer() {} }; unrelated.toLayer(run);",
		'import { Workflow as W } from "effect/workflow"; function run(W) { const job = W.make("job", {}); job.toLayer(run); }',
		'import { Workflow } from "effect/workflow"; const job = Workflow.make("job", {}); function run(job) { job.toLayer(run); }',
	],
	invalid: [
		{
			errors: [{ message: /Register workflows with implementWorkflow/ }],
			code: 'import { Workflow as W } from "effect/workflow"; const job = W.make("job", {}); job.toLayer(run);',
		},
		{
			errors: [{ message: /Register workflows with implementWorkflow/ }],
			code: 'import * as Workflows from "effect/workflow"; const job = Workflows.Workflow.make("job", {}); const alias = job; alias["toLayer"](run);',
		},
	],
});

const manifestFile = "kernel/backend/src/modules/entities/service.ts";
const repositoryFile = "kernel/backend/src/modules/plugins/packages/repository.ts";
const allow = [
	{ file: repositoryFile, owners: ["persist"] },
	{ file: "kernel/backend/src/schema/tables/core.ts", owners: ["pluginRevisionManifest"] },
	{ file: "kernel/backend/src/platform/db/immutable-revisions.ts", owners: "*" },
];
const manifestOptions = [{ allow }];
const manifestRead = { message: /Do not reference pluginRevisionManifest/ };
const manifestText = { message: /Do not read plugin_revision_manifest/ };
const revisionUpdate = { message: /Do not update plugin revisions/ };
const persistRead =
	'const persist = Effect.fn("persist")(function* () { return db.select({ manifest: schema.pluginRevisionManifest.manifest }); });';

ruleTester.run("no-hot-manifest-read", plugin.rules["no-hot-manifest-read"], {
	valid: [
		{ filename: manifestFile, code: "const rows = db.select().from(schema.pluginRevision);" },
		{ filename: repositoryFile, options: manifestOptions, code: persistRead },
		{
			options: manifestOptions,
			filename: "kernel/backend/src/platform/db/immutable-revisions.ts",
			code: 'const sql = "update plugin_revision_manifest"; db.update(pluginRevision);',
		},
		{
			options: manifestOptions,
			filename: "kernel/backend/src/schema/tables/core.ts",
			code: 'export const pluginRevisionManifest = snakeCase.table("plugin_revision_manifest", { manifest: jsonb() });',
		},
		{
			filename: "kernel/backend/src/modules/plugins/test-support.ts",
			code: "db.select().from(schema.pluginRevisionManifest);",
		},
		{
			filename: "kernel/backend/src/modules/entities/service.test.ts",
			code: 'db.execute("select 1 from plugin_revision_manifest");',
		},
		{
			filename: "kernel/backend/src/testing/database.ts",
			code: "db.update(schema.pluginRevision);",
		},
		{
			filename: "kernel/backend/src/drizzle/migration.ts",
			code: 'const sql = "plugin_revision_manifest";',
		},
		{ filename: "apps/server/src/migration.ts", code: 'const sql = "plugin_revision_manifest";' },
		{
			filename: manifestFile,
			code: 'type Manifest = (typeof pluginRevisionManifest.$inferSelect)["manifest"];',
		},
		{
			filename: manifestFile,
			code: 'import type { pluginRevisionManifest } from "#schema"; type Row = pluginRevisionManifest;',
		},
		{ filename: manifestFile, code: "db.update(schema.plugin).set({ status });" },
	],
	invalid: [
		{
			errors: [manifestRead],
			filename: manifestFile,
			code: 'import { pluginRevisionManifest } from "#schema"; const unused = 1;',
		},
		{
			errors: [manifestRead],
			filename: manifestFile,
			code: "const load = () => db.select().from(schema.pluginRevisionManifest);",
		},
		{
			errors: [manifestRead],
			filename: manifestFile,
			code: "const field = () => schema.pluginRevisionManifest.manifest;",
		},
		{
			errors: [manifestRead],
			filename: repositoryFile,
			options: manifestOptions,
			code: persistRead.replace("persist", "hydrate"),
		},
		{
			errors: [manifestRead],
			options: manifestOptions,
			filename: "kernel/backend/src/schema/tables/core.ts",
			code: "const load = () => pluginRevisionManifest.manifest;",
		},
		{
			errors: [manifestText],
			filename: manifestFile,
			code: 'const fragment = sql.raw("select manifest from plugin_revision_manifest");',
		},
		{
			errors: [manifestText],
			filename: manifestFile,
			code: "const fragment = () => `join plugin_revision_manifest on true`;",
		},
		{
			errors: [manifestText],
			filename: manifestFile,
			code: "const fragment = sql`select manifest from plugin_revision_manifest`;",
		},
		{
			errors: [revisionUpdate],
			filename: manifestFile,
			code: "const touch = () => db.update(pluginRevision).set({ hash });",
		},
		{
			errors: [revisionUpdate, manifestRead],
			filename: manifestFile,
			code: "const touch = () => tx.update(tables.pluginRevisionManifest);",
		},
	],
});
