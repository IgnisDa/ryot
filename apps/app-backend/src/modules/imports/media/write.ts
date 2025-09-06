import { addToCollection, getOrCreateCollection } from "~/modules/collections";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas";
import { getBuiltinEventSchemaBySlug } from "~/modules/event-schemas";
import { createEventsBestEffortWithTriggers, type CreateEventBody } from "~/modules/events";

import { importEntityRefKey, type ImportMediaEntityGroup } from "../jobs";
import { createImportRunFailure } from "../repository";

type MediaEntityWriteDeps = {
	addToCollection: typeof addToCollection;
	getOrCreateCollection: typeof getOrCreateCollection;
	createImportRunFailure: typeof createImportRunFailure;
	getBuiltinEventSchemaBySlug: typeof getBuiltinEventSchemaBySlug;
	getBuiltinEntitySchemaBySlug: typeof getBuiltinEntitySchemaBySlug;
	createEventsBestEffortWithTriggers: typeof createEventsBestEffortWithTriggers;
};

const mediaEntityWriteDeps: MediaEntityWriteDeps = {
	addToCollection,
	getOrCreateCollection,
	createImportRunFailure,
	getBuiltinEventSchemaBySlug,
	getBuiltinEntitySchemaBySlug,
	createEventsBestEffortWithTriggers,
};

export const writeMediaEntityGroups = async (
	input: {
		runId: string;
		userId: string;
		failedItems: number;
		importedItems: number;
		startGroupIndex: number;
		entityGroups: ImportMediaEntityGroup[];
		entityIdsByKey: ReadonlyMap<string, string>;
		onGroupComplete: (state: {
			failedItems: number;
			importedItems: number;
			nextGroupIndex: number;
		}) => Promise<void>;
	},
	deps: MediaEntityWriteDeps = mediaEntityWriteDeps,
): Promise<{ importedItems: number; failedItems: number }> => {
	const schemaIdCache = new Map<string, string>();
	const eventSchemaCache = new Map<string, { id: string }>();
	const collectionIdCache = new Map<string, string>();

	let failedItems = input.failedItems;
	let importedItems = input.importedItems;

	// oxlint-disable no-await-in-loop
	for (
		let groupIndex = input.startGroupIndex;
		groupIndex < input.entityGroups.length;
		groupIndex++
	) {
		const group = input.entityGroups[groupIndex];
		if (!group) {
			await input.onGroupComplete({
				failedItems,
				importedItems,
				nextGroupIndex: groupIndex + 1,
			});
			continue;
		}

		const key = importEntityRefKey(group.entityRef);
		const entityId = input.entityIdsByKey.get(key);
		if (!entityId) {
			await input.onGroupComplete({
				failedItems,
				importedItems,
				nextGroupIndex: groupIndex + 1,
			});
			continue;
		}
		let groupFailed = false;

		let entitySchemaId = schemaIdCache.get(group.entityRef.entitySchemaSlug);
		if (!entitySchemaId) {
			const entitySchema = await deps.getBuiltinEntitySchemaBySlug(
				group.entityRef.entitySchemaSlug,
			);
			if (!entitySchema) {
				failedItems++;
				await deps.createImportRunFailure({
					context: null,
					runId: input.runId,
					itemIndex: groupIndex,
					stage: "database_commit",
					sourceLabel: group.entityRef.sourceLabel,
					sourceIdentifier: group.entityRef.externalId,
					entitySchemaSlug: group.entityRef.entitySchemaSlug,
					message: `Entity schema not found: ${group.entityRef.entitySchemaSlug}`,
				});
				await input.onGroupComplete({
					failedItems,
					importedItems,
					nextGroupIndex: groupIndex + 1,
				});
				continue;
			}
			entitySchemaId = entitySchema.id;
			schemaIdCache.set(group.entityRef.entitySchemaSlug, entitySchemaId);
		}

		for (const membership of group.collectionMemberships) {
			try {
				let collectionId = collectionIdCache.get(membership.collectionName);
				if (!collectionId) {
					const collectionResult = await deps.getOrCreateCollection({
						userId: input.userId,
						body: { name: membership.collectionName },
					});
					if ("error" in collectionResult) {
						groupFailed = true;
						await deps.createImportRunFailure({
							context: null,
							runId: input.runId,
							itemIndex: groupIndex,
							stage: "database_commit",
							message: collectionResult.message,
							sourceLabel: group.entityRef.sourceLabel,
							sourceIdentifier: group.entityRef.externalId,
							entitySchemaSlug: group.entityRef.entitySchemaSlug,
						});
						continue;
					}
					collectionId = collectionResult.data.id;
					collectionIdCache.set(membership.collectionName, collectionId);
				}

				const addResult = await deps.addToCollection({
					userId: input.userId,
					body: { entityId, collectionId, properties: {} },
				});
				if ("error" in addResult) {
					groupFailed = true;
					await deps.createImportRunFailure({
						context: null,
						runId: input.runId,
						itemIndex: groupIndex,
						stage: "database_commit",
						message: addResult.message,
						sourceLabel: group.entityRef.sourceLabel,
						sourceIdentifier: group.entityRef.externalId,
						entitySchemaSlug: group.entityRef.entitySchemaSlug,
					});
				}
			} catch (error) {
				groupFailed = true;
				await deps.createImportRunFailure({
					context: null,
					runId: input.runId,
					itemIndex: groupIndex,
					stage: "database_commit",
					sourceLabel: group.entityRef.sourceLabel,
					sourceIdentifier: group.entityRef.externalId,
					entitySchemaSlug: group.entityRef.entitySchemaSlug,
					message: error instanceof Error ? error.message : "Failed to write collection membership",
				});
			}
		}

		const eventInputs: Array<{ eventSchemaSlug: string; body: CreateEventBody }> = [];
		for (const ev of group.events) {
			const schemaKey = `${entitySchemaId}:${ev.eventSchemaSlug}`;
			let eventSchemaData = eventSchemaCache.get(schemaKey);
			if (!eventSchemaData) {
				const found = await deps.getBuiltinEventSchemaBySlug({
					entitySchemaId,
					slug: ev.eventSchemaSlug,
				});
				if (!found) {
					groupFailed = true;
					await deps.createImportRunFailure({
						context: null,
						runId: input.runId,
						itemIndex: groupIndex,
						stage: "database_commit",
						eventSchemaSlug: ev.eventSchemaSlug,
						sourceLabel: group.entityRef.sourceLabel,
						sourceIdentifier: group.entityRef.externalId,
						entitySchemaSlug: group.entityRef.entitySchemaSlug,
						message: `Event schema not found: ${ev.eventSchemaSlug}`,
					});
					continue;
				}
				eventSchemaData = found;
				eventSchemaCache.set(schemaKey, eventSchemaData);
			}

			eventInputs.push({
				eventSchemaSlug: ev.eventSchemaSlug,
				body: {
					entityId,
					occurredAt: ev.occurredAt,
					properties: ev.properties,
					eventSchemaId: eventSchemaData.id,
				},
			});
		}

		if (eventInputs.length > 0) {
			const eventResult = await deps.createEventsBestEffortWithTriggers({
				userId: input.userId,
				body: eventInputs.map((eventInput) => eventInput.body),
			});
			for (const failure of eventResult.data.failures) {
				const eventInput = eventInputs[failure.itemIndex];
				groupFailed = true;
				await deps.createImportRunFailure({
					context: null,
					runId: input.runId,
					itemIndex: groupIndex,
					stage: "database_commit",
					message: failure.message,
					sourceLabel: group.entityRef.sourceLabel,
					eventSchemaSlug: eventInput?.eventSchemaSlug,
					sourceIdentifier: group.entityRef.externalId,
					entitySchemaSlug: group.entityRef.entitySchemaSlug,
				});
			}
		}

		if (groupFailed) {
			failedItems++;
		} else {
			importedItems++;
		}

		await input.onGroupComplete({
			failedItems,
			importedItems,
			nextGroupIndex: groupIndex + 1,
		});
	}
	// oxlint-enable no-await-in-loop

	return { failedItems, importedItems };
};
