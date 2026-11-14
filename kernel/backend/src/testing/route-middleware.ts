import { AdminMiddleware, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { PublicationMiddleware } from "@ryot-app/contract/modules/publications/contract";
import { PublicationUnavailable } from "@ryot-app/contract/modules/publications/schemas";
import { Effect, Layer } from "effect";

export const rejectingAdminAndPublicationMiddleware = Layer.merge(
	Layer.succeed(AdminMiddleware, {
		adminToken: () =>
			Effect.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } })),
	}),
	Layer.succeed(PublicationMiddleware, {
		session: () => Effect.fail(new PublicationUnavailable({ reason: { code: "not-found" } })),
	}),
);
