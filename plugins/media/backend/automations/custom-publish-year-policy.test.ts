import { describe, expect, it } from "@effect/vitest";
import { automationPolicyInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import type { EntityRecord } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { builtinMediaEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import {
	entityRecord,
	policyAutomationContext,
} from "../../tests/backend/automations/automation-test-utils";
import definition from "./custom-publish-year-policy.sandbox";

const run = (
	properties: EntityRecord["properties"],
	options: {
		readonly operation?: "create" | "update" | "delete";
		readonly providerId?: string;
		readonly entitySchemaSlug?: string;
	} = {},
) => {
	const snapshot = entityRecord({
		properties,
		entitySchemaSlug: options.entitySchemaSlug ?? "movie",
	});
	const draft = {
		properties,
		externalId: null,
		populatedAt: null,
		name: snapshot.name,
		providerId: options.providerId ?? null,
		entitySchemaSlug: snapshot.entitySchemaSlug,
		entitySchemaPluginId: snapshot.entitySchemaPluginId,
	};
	const { automation } = Schema.decodeUnknownSync(automationPolicyInputSchema)({
		automation: {
			...policyAutomationContext().automation,
			payload: {
				resource: "entity",
				category: "request",
				operation: options.operation ?? "create",
				draft: options.operation === "delete" ? snapshot : draft,
				...(options.operation === "update"
					? { before: snapshot, changedProperties: ["publishDate"] }
					: {}),
			},
		},
	});
	const { payload, ...invocation } = automation;
	return definition
		.run({ automation: invocation, items: [{ payload, itemIdentity: "media" }] })
		.pipe(Effect.map(({ items }) => items[0]?.decision));
};

describe("custom media publish year", () => {
	it.effect("fills a missing year on creation and update for every media kind", () =>
		Effect.gen(function* () {
			for (const entitySchemaSlug of builtinMediaEntitySchemaSlugs) {
				for (const operation of ["create", "update"] as const) {
					expect(
						yield* run(
							{ description: "Keep this", publishDate: "2024-02-29" },
							{ operation, entitySchemaSlug },
						),
					).toEqual({
						action: "transform",
						patch: {
							resource: "entity",
							draft: { properties: { remove: [], set: { publishYear: 2024 } } },
						},
					});
				}
			}
		}),
	);

	it.effect("preserves explicit years, including when the date disagrees", () =>
		Effect.gen(function* () {
			for (const publishYear of [0, 2020, 2026]) {
				expect(
					yield* run({ publishYear, publishDate: "2026-10-26" }, { operation: "update" }),
				).toEqual({ action: "allow" });
			}
			expect(yield* run({ publishYear: 2020 })).toEqual({ action: "allow" });
		}),
	);

	it.effect("does not invent years from missing, partial, or invalid dates", () =>
		Effect.gen(function* () {
			for (const properties of [
				{},
				...[
					"",
					"2026",
					"2026-10",
					"2026-02-29",
					"2026-04-31",
					"2026-13-01",
					"2026-10-26T00:00:00Z",
				].map((publishDate) => ({ publishDate })),
			]) {
				expect(yield* run(properties)).toEqual({ action: "allow" });
			}
		}),
	);

	it.effect("leaves provider metadata, unsupported schemas, and deletions unchanged", () =>
		Effect.gen(function* () {
			for (const options of [
				{ providerId: "provider-1" },
				{ entitySchemaSlug: "show-episode" },
				{ entitySchemaSlug: "person" },
				{ operation: "delete" as const },
			]) {
				expect(yield* run({ publishDate: "2026-10-26" }, options)).toEqual({ action: "allow" });
			}
		}),
	);
});
