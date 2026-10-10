import { integrationCommonSchema } from "@ryot-app/contract/modules/integrations/schemas";
import { integrationLots } from "@ryot-app/contract/modules/integrations/types";
import { SourcePlan } from "@ryot-app/contract/modules/plugins/execution";
import {
	evaluateIngestionReadiness,
	IngestionReadinessMetadata,
} from "@ryot-app/contract/modules/plugins/ingestion-readiness";
import {
	type DeclarationReference,
	definitionOwner,
	sameDeclaration,
} from "@ryot-app/contract/modules/plugins/references";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import {
	ascending,
	column,
	defineRecipe,
	type Recipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const provider = table("integrationProvider", "provider");

export const integrationProvidersRecipe = defineRecipe(
	(input: {
		readonly after?: string;
		readonly limit: number;
		readonly selected?: {
			readonly reference: DeclarationReference;
			readonly settings: Readonly<Record<string, unknown>>;
			readonly integrationId?: string;
		};
	}) => ({
		map: ({ providers }) =>
			Result.try(() => ({
				...providers,
				items: providers.items.map((item) => {
					const reference = { slug: item.slug, owner: definitionOwner(item.pluginId) };
					const selected =
						input.selected !== undefined && sameDeclaration(input.selected.reference, reference)
							? input.selected
							: undefined;
					return {
						reference,
						...item,
						commonSchema: integrationCommonSchema(
							item.lot,
							item.supportsOwnershipSync,
							item.pluginId !== null,
						),
						readiness:
							item.readinessMetadata === null || item.scriptSlug === null || !item.hasScript
								? { plan: null, blockReasons: [], ready: item.hasScript }
								: evaluateIngestionReadiness({
										kind: "script",
										operation: item.scriptSlug,
										settings: selected?.settings,
										metadata: item.readinessMetadata,
										sourcePlan: item.plan ?? undefined,
										settingsSchema: item.settingsSchema,
										connectedFields: item.readinessConnections
											.filter((connection) => {
												const property = item.settingsSchema.fields[connection.field];
												return (
													selected !== undefined &&
													selected.settings[connection.field] === connection.id &&
													connection.integrationId === (selected.integrationId ?? null) &&
													property?.type === "string" &&
													property.format?.kind === "oauth-connection" &&
													property.format.provider === connection.provider
												);
											})
											.map(({ field }) => field),
									}),
					};
				}),
			})),
		queries: {
			providers: selectedRows(provider, {
				after: input.after,
				limit: input.limit,
				orderBy: [ascending(column(provider, "name")), ascending(column(provider, "id"))],
				selection: {
					id: selectedField(column(provider, "id"), Schema.String),
					slug: selectedField(column(provider, "slug"), Schema.String),
					name: selectedField(column(provider, "name"), Schema.String),
					hasScript: selectedField(column(provider, "hasScript"), Schema.Boolean),
					plan: selectedField(column(provider, "plan"), Schema.NullOr(SourcePlan)),
					description: selectedField(column(provider, "description"), Schema.String),
					settingsSchema: selectedField(column(provider, "settingsSchema"), AppSchema),
					pluginId: selectedField(column(provider, "pluginId"), Schema.NullOr(PluginId)),
					requiresProKey: selectedField(column(provider, "requiresProKey"), Schema.Boolean),
					lot: selectedField(column(provider, "lot"), Schema.Literals([...integrationLots])),
					packageId: selectedField(column(provider, "packageId"), Schema.NullOr(PluginPackageId)),
					scriptSlug: selectedField(column(provider, "scriptSlug"), Schema.NullOr(Schema.String)),
					installationId: selectedField(
						column(provider, "installationId"),
						Schema.NullOr(Schema.String),
					),
					supportsOwnershipSync: selectedField(
						column(provider, "supportsOwnershipSync"),
						Schema.Boolean,
					),
					pluginScope: selectedField(
						column(provider, "pluginScope"),
						Schema.NullOr(Schema.Literals(["system", "user"])),
					),
					readinessMetadata: selectedField(
						column(provider, "readinessMetadata"),
						Schema.NullOr(IngestionReadinessMetadata),
					),
					readinessConnections: selectedField(
						column(provider, "readinessConnections"),
						Schema.Array(
							Schema.Struct({
								id: Schema.String,
								field: Schema.String,
								provider: Schema.String,
								integrationId: Schema.NullOr(Schema.String),
							}),
						),
					),
				},
			}),
		},
	}),
);

export type IntegrationProvidersPage = Recipe.Success<typeof integrationProvidersRecipe>;
