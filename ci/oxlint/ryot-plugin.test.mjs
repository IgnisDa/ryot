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
const appServiceError = { message: /is app-owned/ };

ruleTester.run("no-promise-chains", plugin.rules["no-promise-chains"], {
	valid: [
		"const value = await promise;",
		'import { Effect as Fx } from "effect"; Fx.catch(effect, recover);',
		'import { Effect as Fx } from "@ryot-app/client-sdk/effect"; Fx.finally(effect, cleanup);',
		'import { Effect as Fx } from "@ryot-app/sandbox-sdk/effect"; Fx.then(effect, next);',
		'import * as Fx from "effect/Effect"; Fx.catch(effect, recover);',
		'import * as Effects from "effect"; Effects.Effect.catch(effect, recover);',
		'import * as ClientSdk from "@ryot-app/client-sdk/effect"; ClientSdk.Effect.catch(effect, recover);',
		'import * as SandboxSdk from "@ryot-app/sandbox-sdk/effect"; SandboxSdk.Effect.finally(effect, cleanup);',
	],
	invalid: [
		{ code: "promise.then(next);", errors: [promiseChainError] },
		{ errors: [promiseChainError], code: "const run = () => promise.catch(recover);" },
		{ errors: [promiseChainError], code: "function run() { return promise.finally(cleanup); }" },
		{ errors: [promiseChainError], code: "ordinary.catch(error);" },
		{
			errors: [promiseChainError],
			code: 'import { Schema } from "effect"; Schema.catch(value, recover);',
		},
		{
			errors: [promiseChainError],
			code: 'import * as Effects from "effect"; Effects.catch(value, recover);',
		},
		{
			errors: [promiseChainError],
			code: 'import * as Sdk from "@ryot-app/client-sdk/effect"; Sdk.finally(value, cleanup);',
		},
		{
			errors: [promiseChainError],
			code: 'import { Effect } from "@ryot-app/plugin-kit/effect"; Effect.catch(value, recover);',
		},
	],
});

ruleTester.run("no-app-service-provide", plugin.rules["no-app-service-provide"], {
	invalid: [
		{
			errors: [appServiceError],
			filename: "/repo/kernel/backend/src/service.ts",
			code: 'import { Effect as Fx } from "effect"; import { Database as Db } from "#database"; Fx.provideService(Db, database);',
		},
		{
			errors: [appServiceError],
			filename: "/repo/apps/server/src/service.ts",
			code: 'import * as Fx from "effect/Effect"; import { Database } from "./database"; Fx.provideService(effect, Database, database);',
		},
		{
			errors: [appServiceError],
			filename: "/repo/plugins/media/host/src/service.ts",
			code: 'import * as Effects from "effect"; import { Database } from "@ryot-app/kernel-backend/database"; Effects.Effect.provideService(Database, database);',
		},
		{
			errors: [appServiceError],
			filename: "/repo/apps/server/src/migrations/service.ts",
			code: 'import * as Sdk from "@ryot-app/sandbox-sdk/effect"; import { Database } from "#database"; Sdk.Effect.provideService(Database, database);',
		},
		{
			errors: [appServiceError],
			filename: "C:\\repo\\kernel\\client\\src\\service.ts",
			code: 'import { Effect as Fx } from "@ryot-app/client-sdk/effect"; import { Database } from "#database"; Fx.provideService(Database, database);',
		},
		{
			errors: [appServiceError],
			filename: "/repo/kernel/backend/src/service.ts",
			code: 'import { Effect } from "effect"; import { Database as CurrentUser } from "#database"; Effect.provideService(CurrentUser, database);',
		},
	],
	valid: [
		{
			filename: "/repo/apps/website/src/service.ts",
			code: 'import { Effect } from "effect"; import { Database } from "#database"; Effect.provideService(Database, database);',
		},
		{
			filename: "/repo/kernel/backend/src/service.ts",
			code: 'import { Effect } from "effect"; import { CurrentUser as User } from "#auth"; Effect.provideService(User, user);',
		},
		{
			filename: "/repo/kernel/client/src/service.ts",
			code: 'import { Effect } from "effect"; import { AuthorizationContext as Auth } from "./auth"; Effect.provideService(Auth, auth);',
		},
		{
			filename: "/repo/kernel/backend/src/service.ts",
			code: 'import { Schema } from "effect"; import { Database } from "#database"; Schema.provideService(Database, database);',
		},
		{
			filename: "/repo/kernel/backend/src/service.ts",
			code: 'import * as Effects from "effect"; import { Database } from "#database"; Effects.provideService(Database, database);',
		},
		{
			filename: "/repo/kernel/backend/src/service.ts",
			code: 'import { Effect } from "@ryot-app/plugin-kit/effect"; import { Database } from "#database"; Effect.provideService(Database, database);',
		},
		{
			filename: "C:\\repo\\kernel\\backend\\src\\service.test.ts",
			code: 'import { Effect } from "effect"; import { Database } from "#database"; Effect.provideService(Database, database);',
		},
		{
			filename: "C:\\repo\\kernel\\backend\\src\\test-utils\\service.ts",
			code: 'import { Effect } from "effect"; import { Database } from "#database"; Effect.provideService(Database, database);',
		},
	],
});
