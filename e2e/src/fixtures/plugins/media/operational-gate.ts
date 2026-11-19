import type { EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { getApiClient } from "~/fixtures/kernel/contract-client";
import { getSharedHarnessTarget } from "~/support/harness-target";

import { mediaFixtureInstallation } from "./entity-schemas";

export const startMediaPopulationGate = (
	input: {
		itemCount: number;
		executingUserId: string;
		identifierPrefix: string;
		providerId: SandboxProviderId;
		entitySchemaSlug: EntitySchemaSlug;
	},
	target = getSharedHarnessTarget(),
) =>
	Effect.gen(function* () {
		const pluginId = (yield* mediaFixtureInstallation(target)).id;
		return yield* getApiClient(target).adminCall((client) =>
			client.testSupport.startWorkflowLoadGate({
				payload: {
					...input,
					pluginId,
					source: "netflix",
					workflowSlug: "media-import-population",
					executingUserId: UserId.make(input.executingUserId),
				},
			}),
		);
	});
