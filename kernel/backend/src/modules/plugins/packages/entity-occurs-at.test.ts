import { expect } from "bun:test";

import { testPluginPackageId } from "@ryot-app/contract/testing";
import { assert } from "@ryot-app/testing/assert";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "./revision.test-support";
import type { NormalizedPlugin } from "./types";

type Declared = null | readonly string[];

const withDate = (
	schema: NormalizedPlugin["manifest"]["entitySchemas"][number],
	declared: Declared,
) => ({
	...schema,
	...(declared === null ? {} : { occursAtProperties: declared }),
	propertiesSchema: {
		...schema.propertiesSchema,
		fields: {
			...schema.propertiesSchema.fields,
			date: {
				type: "string" as const,
				label: { key: "test.date" },
				description: "When it happens",
			},
			at: {
				type: "datetime" as const,
				label: { key: "test.at" },
				description: "The instant it happens, when known",
			},
		},
	},
});

const datedPackage = (
	slug: string,
	version: string,
	packageId: ReturnType<typeof testPluginPackageId>,
	declared: Declared,
) => {
	const base = revisionPackage(slug, version, `${slug}-entity`, packageId);
	const [schema, ...others] = base.manifest.entitySchemas;
	assert(schema);
	return {
		...base,
		manifest: { ...base.manifest, entitySchemas: [withDate(schema, declared), ...others] },
	};
};

const insertEntity = (
	id: string,
	pluginId: string,
	slug: string,
	properties: Readonly<Record<string, unknown>>,
) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db
				.insert(tables.entity)
				.values({
					id,
					name: id,
					properties,
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
				datedPackage("dated", "v1", testPluginPackageId(), ["date"]),
			);
			yield* insertEntity("dated-1", pluginId, "dated", { date: "2026-09-04" });
			yield* insertEntity("dated-malformed", pluginId, "dated", { date: "soon" });
			yield* insertEntity("dated-infinite", pluginId, "dated", { date: "infinity" });
			yield* insertEntity("dated-missing", pluginId, "dated", { date: null });

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
				datedPackage("undated", "v1", testPluginPackageId(), null),
			);
			yield* insertEntity("undated-1", pluginId, "undated", { date: "2026-09-04" });

			expect(yield* occursAtOf("undated-1")).toBeNull();
		}),
	);

	test.effect("fills existing rows when a revision adds the declaration", () =>
		Effect.gen(function* () {
			const packageId = testPluginPackageId();
			const { pluginId } = yield* installRevisionPackage(
				datedPackage("late", "v1", packageId, null),
			);
			yield* insertEntity("late-1", pluginId, "late", { date: "2026-09-04" });
			expect(yield* occursAtOf("late-1")).toBeNull();

			yield* installRevisionPackage(datedPackage("late", "v2", packageId, ["date"]));

			expect(yield* occursAtOf("late-1")).toBe("2026-09-04T00:00:00.000Z");
		}),
	);

	test.effect("stores the first declared property that holds a valid timestamp", () =>
		Effect.gen(function* () {
			const { pluginId } = yield* installRevisionPackage(
				datedPackage("timed", "v1", testPluginPackageId(), ["at", "date"]),
			);
			yield* insertEntity("timed-instant", pluginId, "timed", {
				date: "2026-09-04",
				at: "2026-09-04T22:30:00.000Z",
			});
			yield* insertEntity("timed-malformed", pluginId, "timed", {
				at: "tonight",
				date: "2026-09-05",
			});
			yield* insertEntity("timed-date", pluginId, "timed", { date: "2026-09-06" });

			expect(yield* occursAtOf("timed-instant")).toBe("2026-09-04T22:30:00.000Z");
			expect(yield* occursAtOf("timed-malformed")).toBe("2026-09-05T00:00:00.000Z");
			expect(yield* occursAtOf("timed-date")).toBe("2026-09-06T00:00:00.000Z");
		}),
	);

	test.effect("recomputes existing rows when a revision changes the declaration", () =>
		Effect.gen(function* () {
			const packageId = testPluginPackageId();
			const { pluginId } = yield* installRevisionPackage(
				datedPackage("moved", "v1", packageId, ["date"]),
			);
			yield* insertEntity("moved-1", pluginId, "moved", {
				date: "2026-09-04",
				at: "2026-09-04T22:30:00.000Z",
			});
			expect(yield* occursAtOf("moved-1")).toBe("2026-09-04T00:00:00.000Z");

			yield* installRevisionPackage(datedPackage("moved", "v2", packageId, ["at", "date"]));

			expect(yield* occursAtOf("moved-1")).toBe("2026-09-04T22:30:00.000Z");
		}),
	);
});
