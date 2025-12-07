import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../contract";
import { CurrentUser } from "../../lib/auth";
import { UploadsService } from "./service";

export const UploadsRoutesLive = HttpApiBuilder.group(AppContract, "uploads", (handlers) =>
	handlers.handle("uploadTemporary", ({ payload }) =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const service = yield* UploadsService;
			return yield* service.uploadTemporary(user, payload.files);
		}),
	),
);
