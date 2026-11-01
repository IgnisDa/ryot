import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { CreateReminderBody } from "@ryot-app/contract/modules/reminders/schemas";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { randomUuid } from "@ryot-app/testing/random";
import { DateTime, Effect } from "effect";

import { kernelDefinitionSource } from "#modules/definitions/kernel-source";
import { DefinitionRepository } from "#modules/definitions/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

export const reminderTestInput = Effect.fnUntraced(function* () {
	const session = yield* DatabaseSession;
	const id = UserId.make(yield* randomUuid);
	const user = {
		id,
		image: null,
		name: "Owner",
		email: `${id}@example.test`,
		accountGeneration: { userId: id, token: "generation" },
		preferences: { language: null, reportingTimeZone: UTC, disableIntegrations: false },
	} satisfies CurrentUserValue;
	const entityId = EntityId.make(yield* randomUuid);
	yield* session.transaction(
		Effect.gen(function* () {
			yield* (yield* DefinitionRepository).replaceKernelDefinitions(kernelDefinitionSource());
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({
						id,
						name: user.name,
						email: user.email,
						accountGeneration: user.accountGeneration.token,
					}),
			);
			yield* session.run((db) =>
				db
					.insert(tables.entity)
					.values({
						userId: id,
						id: entityId,
						name: "Target",
						entitySchemaPluginId: null,
						entitySchemaSlug: "collection",
					}),
			);
		}),
	);
	const now = yield* DateTime.nowAsDate;
	const body: CreateReminderBody = {
		entityId,
		replaces: null,
		parentEntityId: null,
		timezone: "Asia/Kolkata",
		message: "  A reminder  ",
		submittedAt: now.toISOString(),
		idempotencyKey: yield* randomUuid,
		dueAt: DateTime.formatIso(DateTime.addDuration(DateTime.makeUnsafe(now), "1 hour")),
	};
	return { user, body };
});
