import { UserId } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { useInstanceAdmin } from "#/modules/instance-admin/context";
import { InstanceAdminImpersonationService } from "#/modules/instance-admin/impersonation";
import { transferResetLink } from "#/modules/instance-admin/reset-link-transfer";
import { InstanceAdminService } from "#/modules/instance-admin/service";
import { UsersAdministration } from "#/modules/instance-admin/users-administration";

export const Route = createFileRoute("/instance-admin/users")({ component: InstanceAdminUsers });

function InstanceAdminUsers() {
	const { server, runtime, backInterceptors } = Route.useRouteContext();
	const { sessionId, unauthorized } = useInstanceAdmin();
	const service = runtime.runSync(InstanceAdminService);
	const impersonation = runtime.runSync(InstanceAdminImpersonationService);
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
