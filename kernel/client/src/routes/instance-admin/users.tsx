import { UserId } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";

import { useInstanceAdmin } from "#/modules/instance-admin/context";
import { InstanceAdminImpersonationService } from "#/modules/instance-admin/impersonation";
import { transferAdminLink } from "#/modules/instance-admin/link-transfer";
import { InstanceAdminService } from "#/modules/instance-admin/service";
import { UsersAdministration } from "#/modules/instance-admin/users-administration";

export const Route = createFileRoute("/instance-admin/users")({ component: InstanceAdminUsers });

function InstanceAdminUsers() {
	const { server, runtime, backInterceptors } = Route.useRouteContext();
	const { sessionId, unauthorized } = useInstanceAdmin();
	const service = runtime.runSync(InstanceAdminService);
	const impersonation = runtime.runSync(InstanceAdminImpersonationService);
	const operations = {
		resetUser: (userId: string) => service.resetUser(sessionId, userId),
		deleteUser: (userId: string) => service.deleteUser(sessionId, userId),
		resetUserPassword: (userId: string) => service.resetUserPassword(sessionId, userId),
		impersonateUser: (userId: string) =>
			impersonation.start(sessionId, UserId.make(userId), server),
		setUserDisabled: (userId: string, disabled: boolean) =>
			service.setUserDisabled(sessionId, userId, disabled),
		listUsers: (search: string, after: string | undefined, limit: number) =>
			service.listUsers(sessionId, search, after, limit),
	};

	return (
		<UsersAdministration
			operations={operations}
			onUnauthorized={unauthorized}
			backInterceptors={backInterceptors}
			transferAdminLink={transferAdminLink}
		/>
	);
}
