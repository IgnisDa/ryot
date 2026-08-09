import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AdminApi } from "#/api/admin";
import type { ServerOrigin } from "#/api/origin";

export class GodModeApi extends Context.Service<GodModeApi>()("GodModeApi", {
	make: Effect.gen(function* () {
		const api = yield* AdminApi;
		return {
			getMigrationReport: (origin: ServerOrigin, token: string) =>
				api.run(origin, token, (client) => client.godMode.getMigrationReport()),
			listUsers: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"godMode", "listUsers">,
			) => api.run(origin, token, (client) => client.godMode.listUsers(request)),
			resetUser: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"godMode", "resetUser">,
			) => api.run(origin, token, (client) => client.godMode.resetUser(request)),
			deleteUser: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"godMode", "deleteUser">,
			) => api.run(origin, token, (client) => client.godMode.deleteUser(request)),
			setUserDisabled: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"godMode", "setUserDisabled">,
			) => api.run(origin, token, (client) => client.godMode.setUserDisabled(request)),
			resetUserPassword: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"godMode", "resetUserPassword">,
			) => api.run(origin, token, (client) => client.godMode.resetUserPassword(request)),
			getUserLifecycleOperation: (
				origin: ServerOrigin,
				token: string,
				request: ContractRequest<"godMode", "getUserLifecycleOperation">,
			) => api.run(origin, token, (client) => client.godMode.getUserLifecycleOperation(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
