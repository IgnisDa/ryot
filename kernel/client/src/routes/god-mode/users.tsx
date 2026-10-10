import { UserId } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { useGodMode } from "#/modules/god-mode/context";
import { GodModeImpersonationService } from "#/modules/god-mode/impersonation";
import { transferResetLink } from "#/modules/god-mode/reset-link-transfer";
import { GodModeService } from "#/modules/god-mode/service";
import { UsersAdministration } from "#/modules/god-mode/users-administration";

export const Route = createFileRoute("/god-mode/users")({ component: GodModeUsers });

function GodModeUsers() {
	const { server, runtime, backInterceptors } = Route.useRouteContext();
	const { sessionId, unauthorized } = useGodMode();
	const service = runtime.runSync(GodModeService);
	const impersonation = runtime.runSync(GodModeImpersonationService);
	const operations = {
		resetUser: (userId: string) => Effect.exit(service.resetUser(sessionId, userId)),
		deleteUser: (userId: string) => Effect.exit(service.deleteUser(sessionId, userId)),
		resetUserPassword: (userId: string) =>
			Effect.exit(service.resetUserPassword(sessionId, userId)),
		impersonateUser: (userId: string) =>
			Effect.exit(impersonation.start(sessionId, UserId.make(userId), server)),
		setUserDisabled: (userId: string, disabled: boolean) =>
			Effect.exit(service.setUserDisabled(sessionId, userId, disabled)),
		listUsers: (search: string, after: string | undefined, limit: number) =>
			Effect.exit(service.listUsers(sessionId, search, after, limit)),
	};

	return (
		<UsersAdministration
			operations={operations}
			onUnauthorized={unauthorized}
			backInterceptors={backInterceptors}
			transferResetLink={transferResetLink}
		/>
	);
}
