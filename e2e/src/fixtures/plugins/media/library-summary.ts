import {
	librarySummaryKind,
	librarySummaryProperties,
	librarySummarySourceRecipe,
} from "@ryot-app/media-plugin/shared/library-summary";
import { and, column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";
import { isDeepStrictEqual } from "node:util";

import type { Client } from "~/fixtures/kernel/auth";
import { getEntity } from "~/fixtures/kernel/entities";
import { pollUntil } from "~/fixtures/kernel/polling";
import {
	executeRyotQL,
	executeRyotQLRecipe,
	requireRows,
	requireRyotQLText,
	requireRyotQLValue,
} from "~/fixtures/kernel/ryotql";

/** Waits until the entity's stored library summary is current and equals live computation. */
export const waitForLibrarySummary = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const entity = yield* getEntity(client, entityId);
		const kind = librarySummaryKind(entity.entitySchemaSlug);
		const membership = table("relationship", "membership");
		return yield* pollUntil(
			`library summary for ${entityId}`,
			Effect.gen(function* () {
				const [live] = yield* executeRyotQLRecipe(
					client,
					librarySummarySourceRecipe({ kind, entityIds: [entityId] }),
				);
				const result = yield* executeRyotQL(
					client,
					document({
						memberships: rows(membership, {
							limit: 1,
							where: and(
								eq(column(membership, "sourceEntityId"), literal(entityId)),
								eq(column(membership, "relationshipSchemaSlug"), literal("in-media-library")),
							),
							fields: [
								field("projection", column(membership, "projection")),
								field("status", column(membership, "projectionStatus")),
							],
						}),
					}),
				);
				const [stored] = requireRows(result.data.memberships, "memberships").items;
				return live &&
					stored &&
					requireRyotQLText(stored, "status") === "ready" &&
					isDeepStrictEqual(requireRyotQLValue(stored, "projection"), librarySummaryProperties(live))
					? live
					: null;
			}),
		);
	});
