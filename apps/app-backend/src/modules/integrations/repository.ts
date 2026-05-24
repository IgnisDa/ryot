import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { AppConfig } from "~/lib/config";
import { CurrentDb, dbEffect, schema } from "~/lib/db";
import type { DbError } from "~/lib/errors";

const sinkProviders = new Set([
	"kodi",
	"emby",
	"plex_sink",
	"generic_json",
	"jellyfin_sink",
	"ryot_browser_extension",
]);

type IntegrationRow = {
	readonly id: string;
	readonly lot: string;
	readonly userId: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly provider: string;
	readonly name: string | null;
	readonly isDisabled: boolean;
	readonly syncOwnership: boolean;
	readonly minimumProgress: string;
	readonly maximumProgress: string;
	readonly lastFinishedAt: Date | null;
	readonly extraSettings: Record<string, unknown>;
	readonly providerSpecifics: Record<string, unknown>;
};

export type Integration = Omit<IntegrationRow, "userId"> & {
	readonly webhookUrl?: string;
};

const integrationSelection = {
	id: schema.integration.id,
	lot: schema.integration.lot,
	name: schema.integration.name,
	userId: schema.integration.userId,
	provider: schema.integration.provider,
	createdAt: schema.integration.createdAt,
	updatedAt: schema.integration.updatedAt,
	isDisabled: schema.integration.isDisabled,
	extraSettings: schema.integration.extraSettings,
	syncOwnership: schema.integration.syncOwnership,
	lastFinishedAt: schema.integration.lastFinishedAt,
	minimumProgress: schema.integration.minimumProgress,
	maximumProgress: schema.integration.maximumProgress,
	providerSpecifics: schema.integration.providerSpecifics,
};

const normalizeIntegration = (frontendUrl: string, row: IntegrationRow) => {
	const integration: Integration = {
		id: row.id,
		lot: row.lot,
		name: row.name,
		provider: row.provider,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		isDisabled: row.isDisabled,
		extraSettings: row.extraSettings,
		syncOwnership: row.syncOwnership,
		lastFinishedAt: row.lastFinishedAt,
		minimumProgress: row.minimumProgress,
		maximumProgress: row.maximumProgress,
		providerSpecifics: row.providerSpecifics,
	};

	return sinkProviders.has(row.provider)
		? { ...integration, webhookUrl: `${frontendUrl}/_i/${row.id}` }
		: integration;
};

type IntegrationsRepositoryShape = {
	readonly getForUser: (input: {
		userId: string;
		integrationId: string;
	}) => Effect.Effect<Integration | null, DbError, CurrentDb>;
	readonly listForUser: (input: {
		userId: string;
		provider?: string;
		isDisabled?: boolean;
	}) => Effect.Effect<Integration[], DbError, CurrentDb>;
};

export class IntegrationsRepository extends Effect.Service<IntegrationsRepository>()(
	"IntegrationsRepository",
	{
		effect: Effect.gen(function* () {
			const { frontendUrl } = yield* AppConfig;

			return {
				getForUser: (input) =>
					Effect.gen(function* () {
						const db = yield* CurrentDb;
						const [row] = yield* dbEffect(() =>
							db
								.select(integrationSelection)
								.from(schema.integration)
								.where(
									and(
										eq(schema.integration.id, input.integrationId),
										eq(schema.integration.userId, input.userId),
									),
								)
								.limit(1),
						);

						return row ? normalizeIntegration(frontendUrl, row as IntegrationRow) : null;
					}),
				listForUser: (input) =>
					Effect.gen(function* () {
						const db = yield* CurrentDb;
						const conditions = [eq(schema.integration.userId, input.userId)];
						if (input.provider !== undefined) {
							conditions.push(eq(schema.integration.provider, input.provider));
						}
						if (input.isDisabled !== undefined) {
							conditions.push(eq(schema.integration.isDisabled, input.isDisabled));
						}

						const rows = yield* dbEffect(() =>
							db
								.select(integrationSelection)
								.from(schema.integration)
								.where(and(...conditions)),
						);

						return rows.map((row) => normalizeIntegration(frontendUrl, row as IntegrationRow));
					}),
			} satisfies IntegrationsRepositoryShape;
		}),
	},
) {}
