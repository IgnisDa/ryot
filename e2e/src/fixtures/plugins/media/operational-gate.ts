import type { EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { adminHeaders } from "~/fixtures/kernel/admin";
import { getApiClient } from "~/fixtures/kernel/contract-client";

import { mediaFixtureInstallation } from "./entity-schemas";

export const startMediaPopulationGate = (input: {
	itemCount: number;
	executingUserId: string;
	identifierPrefix: string;
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
}) =>
	Effect.gen(function* () {
		const pluginId = (yield* mediaFixtureInstallation).id;
		return yield* getApiClient().call(
			(client) =>
				client.testSupport.startWorkflowLoadGate({
					payload: {
						...input,
						pluginId,
						source: "netflix",
						workflowSlug: "media-import-population",
						executingUserId: UserId.make(input.executingUserId),
					},
				}),
			adminHeaders(),
		);
	});
