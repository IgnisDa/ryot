import { createFileRoute } from "@tanstack/react-router";

import { useGodMode } from "#/modules/god-mode/context";
import { transferResetLink } from "#/modules/god-mode/reset-link-transfer";
import { GodModeService } from "#/modules/god-mode/service";
import { UsersAdministration } from "#/modules/god-mode/users-administration";

export const Route = createFileRoute("/god-mode/users")({ component: GodModeUsers });

function GodModeUsers() {
	const { runtime, backInterceptors } = Route.useRouteContext();
	const { sessionId, unauthorized } = useGodMode();
	const service = runtime.runSync(GodModeService);
	const operations = {
		resetUser: (userId: string) => runtime.runPromiseExit(service.resetUser(sessionId, userId)),
		deleteUser: (userId: string) => runtime.runPromiseExit(service.deleteUser(sessionId, userId)),
		resetUserPassword: (userId: string) =>
			runtime.runPromiseExit(service.resetUserPassword(sessionId, userId)),
		setUserDisabled: (userId: string, disabled: boolean) =>
			runtime.runPromiseExit(service.setUserDisabled(sessionId, userId, disabled)),
		listUsers: (search: string, offset: number, limit: number) =>
			runtime.runPromiseExit(service.listUsers(sessionId, search, offset, limit)),
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
