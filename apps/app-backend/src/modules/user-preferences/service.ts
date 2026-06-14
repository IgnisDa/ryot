import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner } from "#lib/db/service";

import { UserPreferencesRepository } from "./repository";
import type { UpdateUserPreferencesBody, UserPreferences } from "./schemas";

const normalizePreferences = (value: Record<string, unknown> | null): UserPreferences => ({
	isNsfw: value?.isNsfw === true,
	disableIntegrations: value?.disableIntegrations === true,
	language:
		typeof value?.language === "string" && value.language.length > 0 ? value.language : null,
});

export class UserPreferencesService extends Effect.Service<UserPreferencesService>()(
	"UserPreferencesService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* UserPreferencesRepository;

			const update = Effect.fn("UserPreferencesService.update")(function* (
				user: CurrentUserValue,
				body: UpdateUserPreferencesBody,
			) {
				const existing = normalizePreferences(yield* runWithDb(repository.findByUserId(user.id)));

				const next: UserPreferences = {
					isNsfw: body.isNsfw ?? existing.isNsfw,
					language: body.language !== undefined ? body.language : existing.language,
					disableIntegrations: body.disableIntegrations ?? existing.disableIntegrations,
				};

				yield* runWithDb(repository.updateForUser({ userId: user.id, preferences: next }));

				return next;
			});

			return { update };
		}),
	},
) {}
