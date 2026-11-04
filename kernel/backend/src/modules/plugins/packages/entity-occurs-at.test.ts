import { expect } from "bun:test";

import { assert } from "@ryot-app/testing/assert";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { testPluginPackageId } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "./revision.test-support";
import type { NormalizedPlugin } from "./types";

const withDate = (
	schema: NormalizedPlugin["manifest"]["entitySchemas"][number],
	declared: boolean,
) => ({
	...schema,
	...(declared ? { occursAtProperty: "date" } : {}),
	propertiesSchema: {
		...schema.propertiesSchema,
		fields: {
			...schema.propertiesSchema.fields,
			date: { label: "Date", type: "string" as const, description: "When it happens" },
		},
	},
});

const datedPackage = (
	slug: string,
	version: string,
	packageId: ReturnType<typeof testPluginPackageId>,
	declared: boolean,
) => {
	const base = revisionPackage(slug, version, `${slug}-entity`, packageId);
	const [schema, ...others] = base.manifest.entitySchemas;
	assert(schema);
	return {
		...base,
		manifest: { ...base.manifest, entitySchemas: [withDate(schema, declared), ...others] },
	};
};

const insertEntity = (id: string, pluginId: string, slug: string, date: unknown) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db
				.insert(tables.entity)
				.values({
					id,
					name: id,
					properties: { date },
					entitySchemaPluginId: pluginId,
					entitySchemaSlug: `${slug}-entity`,
				}),
		);
	});

const occursAtOf = (id: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const [row] = yield* session.run((db) =>
			db
				.select({ occursAt: tables.entity.occursAt })
				.from(tables.entity)
				.where(eq(tables.entity.id, id)),
		);
		assert(row);
		return row.occursAt?.toISOString() ?? null;
	});

layer(revisionDatabaseLayer)((test) => {
	test.effect("copies the declared property on insert and update", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const { pluginId } = yield* installRevisionPackage(
				datedPackage("dated", "v1", testPluginPackageId(), true),
			);
			yield* insertEntity("dated-1", pluginId, "dated", "2026-09-04");
			yield* insertEntity("dated-malformed", pluginId, "dated", "soon");
			yield* insertEntity("dated-infinite", pluginId, "dated", "infinity");
			yield* insertEntity("dated-missing", pluginId, "dated", null);

			expect(yield* occursAtOf("dated-1")).toBe("2026-09-04T00:00:00.000Z");
			expect(yield* occursAtOf("dated-malformed")).toBeNull();
			expect(yield* occursAtOf("dated-infinite")).toBeNull();
			expect(yield* occursAtOf("dated-missing")).toBeNull();

			yield* session.run((db) =>
				db
					.update(tables.entity)
					.set({ properties: { date: "2026-10-01" } })
					.where(eq(tables.entity.id, "dated-1")),
			);
			expect(yield* occursAtOf("dated-1")).toBe("2026-10-01T00:00:00.000Z");
		}),
	);

	test.effect("leaves a schema without a declaration empty", () =>
		Effect.gen(function* () {
			const { pluginId } = yield* installRevisionPackage(
				datedPackage("undated", "v1", testPluginPackageId(), false),
			);
			yield* insertEntity("undated-1", pluginId, "undated", "2026-09-04");

			expect(yield* occursAtOf("undated-1")).toBeNull();
		}),
	);

	test.effect("fills existing rows when a revision adds the declaration", () =>
		Effect.gen(function* () {
			const packageId = testPluginPackageId();
			const { pluginId } = yield* installRevisionPackage(
				datedPackage("late", "v1", packageId, false),
			);
			yield* insertEntity("late-1", pluginId, "late", "2026-09-04");
			expect(yield* occursAtOf("late-1")).toBeNull();

			yield* installRevisionPackage(datedPackage("late", "v2", packageId, true));

			expect(yield* occursAtOf("late-1")).toBe("2026-09-04T00:00:00.000Z");
		}),
	);
});
