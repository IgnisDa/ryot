import { AppContract } from "@ryot-app/contract/contract";
import { OpenApi } from "effect/http-api";
import { describe, expect, it } from "vitest";

const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

describe("OpenAPI documentation", () => {
	it("describes every group and route", () => {
		const spec = OpenApi.fromApi(AppContract);
		const undocumentedGroups = spec.tags
			.filter((tag) => !tag.description?.trim())
			.map((tag) => tag.name);
		const undocumentedRoutes = Object.entries(spec.paths).flatMap(([path, item]) =>
			methods.flatMap((method) => {
				const operation = item[method];
				return operation && !operation.description?.trim()
					? [`${method.toUpperCase()} ${path}`]
					: [];
			}),
		);

		expect(undocumentedGroups).toEqual([]);
		expect(undocumentedRoutes).toEqual([]);
	});

	it("documents the user plugin installation surface", () => {
		const spec = OpenApi.fromApi(AppContract);
		expect(spec.paths["/plugins/installations/{installationId}/state"]?.patch?.security).toEqual([
			{ oauth: [] },
			{ apiKey: [] },
		]);
		for (const status of [400, 404, 409]) {
			expect(
				spec.paths["/plugins/installations/{installationId}/state"]?.patch?.responses[status],
			).toBeDefined();
		}
		expect(spec.paths["/plugins"]?.post?.description).toContain("precompiled plugin archive");
		expect(
			spec.paths["/plugins/installations/{installationId}/{activationId}"]?.delete?.responses[
				"409"
			],
		).toBeDefined();
		const systemPlugins = spec.paths["/test-support/system-plugins"];
		expect(systemPlugins?.post?.security).toEqual([{ adminToken: [] }]);
		expect(systemPlugins?.get).toBeUndefined();
		expect(
			spec.paths["/test-support/system-plugins/{pluginId}/{activationId}"]?.delete?.security,
		).toEqual([{ adminToken: [] }]);
	});

	it("documents OAuth and API-key authentication without Better Auth cookie internals", () => {
		const spec = OpenApi.fromApi(AppContract);
		expect(spec.paths["/ryotql/execute"]?.post?.security).toEqual([{ oauth: [] }, { apiKey: [] }]);
		expect(spec.components.securitySchemes["oauth"]).toEqual({ type: "http", scheme: "Bearer" });
		expect(spec.components.securitySchemes["apiKey"]).toEqual({
			in: "header",
			type: "apiKey",
			name: "x-api-key",
		});
	});

	it("documents durable user lifecycle operations as admin-only asynchronous requests", () => {
		const spec = OpenApi.fromApi(AppContract);
		expect(spec.paths["/instance-admin/users/{userId}"]?.delete?.responses["202"]).toBeDefined();
		expect(
			spec.paths["/instance-admin/users/{userId}/reset"]?.post?.responses["202"],
		).toBeDefined();
		for (const path of [
			"/instance-admin/users/{userId}",
			"/instance-admin/users/{userId}/reset",
			"/instance-admin/users/{userId}/reset-password",
			"/instance-admin/users/{userId}/disable/set",
			"/instance-admin/users/provision",
		]) {
			const operation = spec.paths[path]?.delete ?? spec.paths[path]?.post;
			expect(operation?.security, path).toEqual([{ adminToken: [] }]);
		}
	});

	it("documents plugin-audience RyotQL as user-authenticated and admin RyotQL as admin-only", () => {
		const spec = OpenApi.fromApi(AppContract);
		expect(spec.paths["/ryotql/plugin/execute"]?.post?.security).toEqual([
			{ oauth: [] },
			{ apiKey: [] },
		]);
		expect(spec.paths["/instance-admin/ryotql/execute"]?.post?.security).toEqual([
			{ adminToken: [] },
		]);
	});

	it("omits retired row-read endpoints while keeping their command and stream routes", () => {
		const paths = OpenApi.fromApi(AppContract).paths;
		for (const path of [
			"/plugins",
			"/definitions/entities",
			"/definitions/relationships",
			"/user-settings",
			"/backups/runs",
			"/backups/runs/{id}",
			"/imports/sources",
			"/integrations/providers",
			"/integrations/{integrationId}",
			"/automations/catalog",
			"/automations/catalog/{signalSchemaSlug}",
			"/automations/runs",
			"/automations/runs/{runId}",
			"/instance-admin/users",
			"/instance-admin/migration-report",
			"/instance-admin/user-lifecycle-operations/{operationId}",
		]) {
			expect(paths[path]?.get, `GET ${path}`).toBeUndefined();
		}
		expect(paths["/definitions/plugins/{pluginSlug}"]).toBeUndefined();
		for (const path of [
			"/test-support/sandbox-scripts/{scriptId}",
			"/test-support/sandbox-scripts",
			"/test-support/users/{userId}/automation-rules/count",
			"/test-support/relationships/global/list",
			"/test-support/entity-schemas/builtin/{slug}",
			"/test-support/entity-translations/{entityId}",
			"/test-support/automations/triggers/list",
			"/test-support/automations/trigger-recipients/list",
			"/test-support/automations/runs/list",
			"/test-support/automations/run-attempts/list",
		]) {
			expect(paths[path], path).toBeUndefined();
		}
		expect(paths["/test-support/system-plugins"]?.get).toBeUndefined();
		expect(paths["/test-support/system-plugins"]?.post?.security).toEqual([{ adminToken: [] }]);
		expect(paths["/test-support/automations/reconcile"]?.post).toBeDefined();
		expect(paths["/test-support/sandbox/result/{jobId}"]?.get).toBeDefined();
		expect(paths["/test-support/entity-translations"]?.put).toBeDefined();
		expect(paths["/test-support/relationships/global"]?.put).toBeDefined();
		expect(paths["/plugins/installations/{installationId}/state"]?.patch).toBeDefined();
		expect(paths["/backups/runs/{id}/download"]?.get).toBeDefined();
		expect(paths["/backups/runs/{id}/download-url"]?.post).toBeDefined();
		expect(paths["/imports/runs/{runId}/failures/download-url"]?.post).toBeDefined();
		expect(paths["/backups/runs/{id}"]?.delete).toBeDefined();
		expect(paths["/integrations/{integrationId}"]?.patch).toBeDefined();
		expect(paths["/automations/rules"]?.post).toBeDefined();
		expect(paths["/automations/rules/{ruleId}/activate"]?.post).toBeDefined();
		expect(paths["/automations/rules/{ruleId}/deactivate"]?.post).toBeDefined();
		expect(paths["/automations/rules/{ruleId}"]?.delete).toBeDefined();
		expect(paths["/automations/runs/{runId}/retry"]?.post).toBeDefined();
	});
});
