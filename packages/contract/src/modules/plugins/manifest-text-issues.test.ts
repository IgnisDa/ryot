import { describe, expect, it } from "bun:test";

import { KERNEL_NAMESPACE, type MessageParam } from "@ryot-app/i18n/message";

import { fixtureManifest, manifestCatalogs } from "../../testing";
import type { AuthoredSchemaText } from "./manifest-text";
import { manifestTextIssues } from "./manifest-text-issues";

const manifest = fixtureManifest();

const { en: catalog } = manifestCatalogs(manifest);

const withLabel = (label: AuthoredSchemaText) => ({
	...manifest,
	configSchema: {
		unknownKeys: "strict" as const,
		fields: { model: { label, description: "Model", type: "string" as const } },
	},
});

const kernel = (key: string, params?: Readonly<Record<string, MessageParam>>) => ({
	key,
	namespace: KERNEL_NAMESPACE,
	...(params === undefined ? {} : { params }),
});

const issues = (label: AuthoredSchemaText) =>
	manifestTextIssues(withLabel(label), catalog).map(({ key, code, detail }) => [code, key, detail]);

describe("manifest text issues", () => {
	it("accepts manifest text with exactly its declared arguments", () => {
		expect(manifestTextIssues(manifest, catalog)).toEqual([]);
	});

	it("checks the parameter labels of declared query documents", () => {
		const withQuery = {
			...manifest,
			queries: {
				find: {
					title: "Find",
					description: "Find entities",
					document: {
						queries: {},
						parameters: {
							fields: {
								kind: {
									description: "Kind",
									type: "string" as const,
									label: kernel("missing.key"),
								},
								name: {
									description: "Name",
									type: "string" as const,
									label: { key: "test.query-parameter" },
								},
							},
						},
					},
				},
			},
		};
		expect(
			manifestTextIssues(withQuery, catalog).map(({ key, code, detail }) => [code, key, detail]),
		).toEqual([
			[
				"unknown-key",
				"test.query-parameter",
				"queries.find.document.parameters.fields.name.label names a key that has no source-locale message",
			],
			[
				"unknown-key",
				"missing.key",
				"queries.find.document.parameters.fields.kind.label names no kernel message",
			],
		]);
	});

	it("rejects missing plugin keys and plugin messages with arguments", () => {
		const { "test.changed": _changed, ...withoutChanged } = catalog;
		expect(
			manifestTextIssues(manifest, {
				...withoutChanged,
				"test.fixture-plugin": [{ type: 1, value: "name" }],
			}).map(({ key, code, detail }) => [code, key, detail]),
		).toEqual([
			[
				"argument-mismatch",
				"test.fixture-plugin",
				"metadata.description names a message with arguments",
			],
			[
				"unknown-key",
				"test.changed",
				"entitySchemas.fixture-entity.eventSchemas.changed.name names a key that has no source-locale message",
			],
		]);
	});

	it("checks embedded kernel messages against the English kernel catalog", () => {
		const using = "client.assistant.provider.using";
		expect(issues(kernel(using, { model: "Claude", source: "instance" }))).toEqual([]);
		expect(
			issues(kernel(using, { source: "user", model: kernel("definition.property.item") })),
		).toEqual([]);
		const mismatch =
			"configSchema.fields.model.label passes parameters that do not match the kernel message's arguments";
		const invalidParams: ReadonlyArray<Readonly<Record<string, MessageParam>>> = [
			{ model: "Claude" },
			{ model: "Claude", source: "unknown" },
			{ model: 1, source: "user" },
			{ extra: "x", source: "user", model: "Claude" },
		];
		for (const params of invalidParams) {
			expect(issues(kernel(using, params))).toEqual([["argument-mismatch", using, mismatch]]);
		}
		expect(issues(kernel("definition.property.missing"))).toEqual([
			[
				"unknown-key",
				"definition.property.missing",
				"configSchema.fields.model.label names no kernel message",
			],
		]);
		expect(
			issues(kernel(using, { source: "user", model: { key: "other.text", namespace: "other" } })),
		).toEqual([
			["unknown-key", "other.text", "configSchema.fields.model.label names no kernel message"],
		]);
	});
});
