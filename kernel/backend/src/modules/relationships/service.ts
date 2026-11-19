import { Context, Effect, Layer } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainWriteChecks } from "#modules/entities/write-context";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";

import { makePlannedRelationshipReconciliation } from "./planned-reconciliation";
import { makePreparedRelationshipMutations } from "./prepared-mutations";
import { RelationshipsRepository } from "./repository";

/** Relationship preparation and persistence for the commits that own relationship writes. */
export class RelationshipsService extends Context.Service<RelationshipsService>()(
	"@ryot-app/kernel-backend/modules/relationships/service/RelationshipsService",
	{
		make: Effect.gen(function* () {
			const dependencies = {
				session: yield* DatabaseSession,
				writes: yield* DomainWriteChecks,
				planner: yield* LifecyclePlanner,
				keys: yield* IdempotencyKeys.make,
				entities: yield* EntitiesRepository,
				runtime: yield* PluginRuntimeResolver,
				admission: yield* AccountAdmission.make,
				definitions: yield* DefinitionRepository,
				repository: yield* RelationshipsRepository,
				assetReferences: yield* ManagedAssetReferenceLocker.make,
			};
			return {
				...makePreparedRelationshipMutations(dependencies),
				...makePlannedRelationshipReconciliation(dependencies),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
