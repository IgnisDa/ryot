import { and, desc, eq } from "drizzle-orm";

import { assertPersisted, db } from "~/lib/db";
import { importRun, integration } from "~/lib/db/schema";

import type {
	IntegrationExtraSettings,
	IntegrationLot,
	IntegrationProviderSpecifics,
	ListedIntegration,
} from "./schemas";

const integrationSelection = {
	id: integration.id,
	lot: integration.lot,
	name: integration.name,
	userId: integration.userId,
	provider: integration.provider,
	createdAt: integration.createdAt,
	updatedAt: integration.updatedAt,
	isDisabled: integration.isDisabled,
	extraSettings: integration.extraSettings,
	syncOwnership: integration.syncOwnership,
	lastFinishedAt: integration.lastFinishedAt,
	minimumProgress: integration.minimumProgress,
	maximumProgress: integration.maximumProgress,
	providerSpecifics: integration.providerSpecifics,
};

type IntegrationRow = Pick<typeof integration.$inferSelect, keyof typeof integrationSelection>;

export const normalizeIntegration = (
	row: IntegrationRow,
): ListedIntegration & { userId: string } => ({
	id: row.id,
	lot: row.lot,
	name: row.name,
	userId: row.userId,
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
});

export const createIntegrationRow = async (input: {
	userId: string;
	provider: string;
	lot: IntegrationLot;
	name?: string | null;
	isDisabled: boolean;
	syncOwnership: boolean;
	minimumProgress: string;
	maximumProgress: string;
	extraSettings: IntegrationExtraSettings;
	providerSpecifics: IntegrationProviderSpecifics;
}): Promise<ListedIntegration & { userId: string }> => {
	const [created] = await db
		.insert(integration)
		.values({
			lot: input.lot,
			userId: input.userId,
			provider: input.provider,
			name: input.name ?? null,
			isDisabled: input.isDisabled,
			extraSettings: input.extraSettings,
			syncOwnership: input.syncOwnership,
			minimumProgress: input.minimumProgress,
			maximumProgress: input.maximumProgress,
			providerSpecifics: input.providerSpecifics,
		})
		.returning(integrationSelection);
	return normalizeIntegration(assertPersisted(created, "integration"));
};

export const getIntegrationById = async (input: {
	id: string;
	userId: string;
}): Promise<(ListedIntegration & { userId: string }) | undefined> => {
	const [found] = await db
		.select(integrationSelection)
		.from(integration)
		.where(and(eq(integration.id, input.id), eq(integration.userId, input.userId)))
		.limit(1);
	return found ? normalizeIntegration(found) : undefined;
};

export const getIntegrationByIdAnyUser = async (input: {
	id: string;
}): Promise<(ListedIntegration & { userId: string }) | undefined> => {
	const [found] = await db
		.select(integrationSelection)
		.from(integration)
		.where(eq(integration.id, input.id))
		.limit(1);
	return found ? normalizeIntegration(found) : undefined;
};

export const listIntegrationsByUser = async (input: {
	userId: string;
	provider?: string;
	isDisabled?: boolean;
}): Promise<(ListedIntegration & { userId: string })[]> => {
	const conditions = [eq(integration.userId, input.userId)];
	if (input.provider !== undefined) {
		conditions.push(eq(integration.provider, input.provider));
	}
	if (input.isDisabled !== undefined) {
		conditions.push(eq(integration.isDisabled, input.isDisabled));
	}
	const rows = await db
		.select(integrationSelection)
		.from(integration)
		.where(and(...conditions))
		.orderBy(desc(integration.createdAt));
	return rows.map(normalizeIntegration);
};

export const updateIntegrationRow = async (input: {
	id: string;
	userId: string;
	name?: string | null;
	isDisabled?: boolean;
	syncOwnership?: boolean;
	minimumProgress?: string;
	maximumProgress?: string;
	lastFinishedAt?: Date | null;
	extraSettings?: IntegrationExtraSettings;
	providerSpecifics?: IntegrationProviderSpecifics;
}): Promise<ListedIntegration & { userId: string }> => {
	type UpdateSet = Partial<typeof integration.$inferInsert>;
	const updates: UpdateSet = {};
	if (input.name !== undefined) {
		updates.name = input.name;
	}
	if (input.isDisabled !== undefined) {
		updates.isDisabled = input.isDisabled;
	}
	if (input.syncOwnership !== undefined) {
		updates.syncOwnership = input.syncOwnership;
	}
	if (input.minimumProgress !== undefined) {
		updates.minimumProgress = input.minimumProgress;
	}
	if (input.maximumProgress !== undefined) {
		updates.maximumProgress = input.maximumProgress;
	}
	if (input.lastFinishedAt !== undefined) {
		updates.lastFinishedAt = input.lastFinishedAt ?? null;
	}
	if (input.extraSettings !== undefined) {
		updates.extraSettings = input.extraSettings;
	}
	if (input.providerSpecifics !== undefined) {
		updates.providerSpecifics = input.providerSpecifics;
	}
	const [updated] = await db
		.update(integration)
		.set(updates)
		.where(and(eq(integration.id, input.id), eq(integration.userId, input.userId)))
		.returning(integrationSelection);
	return normalizeIntegration(assertPersisted(updated, "integration"));
};

export const deleteIntegrationRow = async (input: {
	id: string;
	userId: string;
}): Promise<void> => {
	await db
		.delete(integration)
		.where(and(eq(integration.id, input.id), eq(integration.userId, input.userId)));
};

export const listIntegrationRunsByIntegrationId = async (input: {
	integrationId: string;
	userId: string;
}) => {
	return db
		.select({
			id: importRun.id,
			source: importRun.source,
			status: importRun.status,
			progress: importRun.progress,
			createdAt: importRun.createdAt,
			updatedAt: importRun.updatedAt,
			startedAt: importRun.startedAt,
			finishedAt: importRun.finishedAt,
			totalItems: importRun.totalItems,
			failedItems: importRun.failedItems,
			errorSummary: importRun.errorSummary,
			inputSummary: importRun.inputSummary,
			importedItems: importRun.importedItems,
			processedItems: importRun.processedItems,
		})
		.from(importRun)
		.where(
			and(eq(importRun.integrationId, input.integrationId), eq(importRun.userId, input.userId)),
		)
		.orderBy(desc(importRun.createdAt));
};

export const listAllEnabledYankIntegrations = async (): Promise<
	(ListedIntegration & { userId: string })[]
> => {
	const rows = await db
		.select(integrationSelection)
		.from(integration)
		.where(and(eq(integration.lot, "yank"), eq(integration.isDisabled, false)));
	return rows.map(normalizeIntegration);
};

export const getLastNRunsForIntegration = async (input: {
	count: number;
	integrationId: string;
}) => {
	return db
		.select({ status: importRun.status })
		.from(importRun)
		.where(eq(importRun.integrationId, input.integrationId))
		.orderBy(desc(importRun.createdAt))
		.limit(input.count);
};
