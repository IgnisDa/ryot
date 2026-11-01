import { assert } from "@effect/vitest";
import type { PluginId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { EventStreamRepository, type StreamKey } from "./stream-repository";

export const streamState = (id: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const [row] = yield* session.run((db) =>
			db
				.select({
					status: tables.backgroundWork.status,
					streamRevision: tables.eventStream.revision,
					dirtyFrom: tables.eventStreamWork.dirtyFrom,
					pluginPin: tables.eventStreamWork.pluginPin,
					checkpoint: tables.eventStreamWork.checkpoint,
					accountToken: tables.eventStreamWork.accountToken,
					currentJobId: tables.eventStreamWork.currentJobId,
					outputSchema: tables.eventStreamWork.outputSchema,
					pluginRevisionId: tables.eventStreamWork.pluginRevisionId,
					completedRevision: tables.eventStreamWork.completedRevision,
					processorScriptId: tables.eventStreamWork.processorScriptId,
				})
				.from(tables.eventStream)
				.leftJoin(tables.eventStreamWork, eq(tables.eventStreamWork.id, tables.eventStream.id))
				.leftJoin(
					tables.backgroundWork,
					eq(tables.backgroundWork.id, tables.eventStreamWork.currentJobId),
				)
				.where(eq(tables.eventStream.id, id)),
		);
		return row ?? null;
	});

export const seedStreamWork = (
	key: StreamKey & { readonly eventSchemaPluginId: PluginId },
	work: Partial<typeof tables.eventStreamWork.$inferInsert> = {},
) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const streams = yield* EventStreamRepository;
		return yield* session.transaction(
			Effect.gen(function* () {
				const [stream] = yield* streams.ensureStreams([key]);
				assert(stream);
				yield* session.run((db) =>
					db
						.insert(tables.eventStreamWork)
						.values({
							pluginPin: {},
							id: stream.id,
							userId: key.userId,
							outputSchema: { fields: {} },
							eventSchemaSlug: key.eventSchemaSlug,
							accountToken: "stream-account-token",
							processorScriptId: "stream-processor",
							pluginRevisionId: "stream-plugin-revision",
							eventSchemaPluginId: key.eventSchemaPluginId,
							...work,
						}),
				);
				return stream;
			}),
		);
	});
