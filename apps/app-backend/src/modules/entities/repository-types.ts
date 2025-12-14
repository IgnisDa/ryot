import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type { EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";

export type SaveEntityInputBase = {
	name: string;
	entitySchemaId: EntitySchemaId;
} & (
	| {
			scope: "global";
			externalId: string;
			populatedAt: Date | null;
			sandboxScriptId: SandboxScriptId;
			onConflict?: "preserveExisting" | "replaceExisting" | undefined;
	  }
	| {
			scope: "user";
			userId: UserId;
			externalId?: string | undefined;
			sandboxScriptId?: SandboxScriptId | undefined;
			onConflict?: "preserveExisting" | "replaceExisting" | undefined;
	  }
);

export type SaveEntityInput = SaveEntityInputBase & { properties: Record<string, unknown> };

export type SaveEntityOutcome =
	| { operation: "create" | "noop"; entity: ListedEntity }
	| { operation: "update"; entity: ListedEntity; before: ListedEntity };
