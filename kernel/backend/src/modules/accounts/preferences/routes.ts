import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { UserSettingsService } from "./service";

export const UserSettingsRoutesLive = HttpApiBuilder.group(AppContract, "account", (handlers) =>
	handlers
		.handle("rename", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UserSettingsService;
				return yield* service.rename(user, payload.name).pipe(dieOnDbError);
			}),
		)
		.handle("updatePreferences", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UserSettingsService;
				return yield* service.updatePreferences(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("createApiKey", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UserSettingsService;
				return yield* service.createApiKey(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("revokeApiKey", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UserSettingsService;
				return yield* service.revokeApiKey(user, params.apiKeyId).pipe(dieOnDbError);
			}),
		)
		.handle("refreshAvatar", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UserSettingsService;
				return yield* service.refreshAvatar(user).pipe(dieOnDbError);
			}),
		),
);
