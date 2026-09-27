import { integrationCommonSchema } from "@ryot-app/contract/modules/integrations/schemas";
import { integrationLots } from "@ryot-app/contract/modules/integrations/types";
import { SourcePlan } from "@ryot-app/contract/modules/plugins/execution";
import {
	evaluateIngestionReadiness,
	IngestionReadinessMetadata,
} from "@ryot-app/contract/modules/plugins/ingestion-readiness";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import {
	ascending,
	column,
	defineRecipe,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const provider = table("integrationProvider", "provider");

export const integrationProvidersRecipe = defineRecipe(
	(input: {
		readonly after?: string;
		readonly limit: number;
		readonly selected?: {
			readonly slug: string;
			readonly settings: Readonly<Record<string, unknown>>;
			readonly integrationId?: string;
		};
	}) => ({
		map: ({ providers }) =>
			Result.try(() => ({
				...providers,
				items: providers.items.map((item) => ({
					...item,
					commonSchema: integrationCommonSchema(
						item.lot,
						item.supportsOwnershipSync,
						item.pluginSlug !== null,
					),
					readiness:
						item.readinessMetadata === null || item.scriptSlug === null || !item.hasScript
							? { plan: null, blockReasons: [], ready: item.hasScript }
							: evaluateIngestionReadiness({
									kind: "script",
									operation: item.scriptSlug,
									metadata: item.readinessMetadata,
									sourcePlan: item.plan ?? undefined,
									settingsSchema: item.settingsSchema,
									settings:
										input.selected?.slug === item.slug ? input.selected.settings : undefined,
									connectedFields: item.readinessConnections
										.filter((connection) => {
											const property = item.settingsSchema.fields[connection.field];
											return (
												input.selected?.slug === item.slug &&
												input.selected.settings[connection.field] === connection.id &&
												connection.integrationId === (input.selected.integrationId ?? null) &&
												property?.type === "string" &&
												property.format?.kind === "oauth-connection" &&
												property.format.provider === connection.provider
											);
										})
										.map(({ field }) => field),
								}),
				})),
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
					requiresProKey: selectedField(column(provider, "requiresProKey"), Schema.Boolean),
					lot: selectedField(column(provider, "lot"), Schema.Literals([...integrationLots])),
					scriptSlug: selectedField(column(provider, "scriptSlug"), Schema.NullOr(Schema.String)),
					pluginSlug: selectedField(column(provider, "pluginSlug"), Schema.NullOr(Schema.String)),
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
