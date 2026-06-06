import type { Job } from "bullmq";

import { addToCollection, getOrCreateCollection } from "~/modules/collections";
import { ensureEntityInLibrary } from "~/modules/entities";
import { populateGlobalEntity } from "~/modules/entities/population";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas";
import { getBuiltinEventSchemaBySlug } from "~/modules/event-schemas";
import { createEventsBestEffortWithTriggers, type CreateEventBody } from "~/modules/events";
import { getBuiltinSandboxScriptBySlug } from "~/modules/sandbox";

import type { ImportEntityRef, ImportMediaEntityGroup } from "../../jobs";
import { createImportRunFailure } from "../../repository";

export const entityRefKey = (ref: ImportEntityRef) =>
	`${ref.entitySchemaSlug}|${ref.scriptSlug}|${ref.externalId}`;

export type MediaProcessorDeps = {
	addToCollection: typeof addToCollection;
	populateGlobalEntity: typeof populateGlobalEntity;
	ensureEntityInLibrary: typeof ensureEntityInLibrary;
	getOrCreateCollection: typeof getOrCreateCollection;
	createImportRunFailure: typeof createImportRunFailure;
	getBuiltinEventSchemaBySlug: typeof getBuiltinEventSchemaBySlug;
	getBuiltinEntitySchemaBySlug: typeof getBuiltinEntitySchemaBySlug;
	getBuiltinSandboxScriptBySlug: typeof getBuiltinSandboxScriptBySlug;
	createEventsBestEffortWithTriggers: typeof createEventsBestEffortWithTriggers;
};

export const mediaProcessorDeps: MediaProcessorDeps = {
	addToCollection,
	populateGlobalEntity,
	ensureEntityInLibrary,
	getOrCreateCollection,
	createImportRunFailure,
	getBuiltinEventSchemaBySlug,
	getBuiltinEntitySchemaBySlug,
	getBuiltinSandboxScriptBySlug,
	createEventsBestEffortWithTriggers,
};

export const populateMediaEntityRefs = async (
	job: Job,
	token: string | undefined,
	input: {
		runId: string;
		userId: string;
		startIndex: number;
		traktUsername: string;
		failedIndices: number[];
		adapterFailureCount: number;
		entityRefs: ImportEntityRef[];
		entityIds: Array<string | null>;
		currentSandboxJobId: string | undefined;
		mediaEntityGroups: ImportMediaEntityGroup[];
		onEntityProcessed?: (processedCount: number) => Promise<void>;
	},
	deps: Pick<
		MediaProcessorDeps,
		| "populateGlobalEntity"
		| "ensureEntityInLibrary"
		| "createImportRunFailure"
		| "getBuiltinEntitySchemaBySlug"
		| "getBuiltinSandboxScriptBySlug"
	> = mediaProcessorDeps,
): Promise<{ failedIndices: number[]; entityIds: Array<string | null> }> => {
	const failedIndices = [...input.failedIndices];
	const entityIds = [...input.entityIds];
	while (entityIds.length < input.entityRefs.length) {
		entityIds.push(null);
	}

	const baseSnapshot = {
		runId: input.runId,
		userId: input.userId,
		providerEntityIds: entityIds,
		traktUsername: input.traktUsername,
		providerEntityRefs: input.entityRefs,
		mediaEntityGroups: input.mediaEntityGroups,
		importStep: "populating_entities" as const,
		adapterFailureCount: input.adapterFailureCount,
	};

	// oxlint-disable no-await-in-loop
	for (let i = input.startIndex; i < input.entityRefs.length; i++) {
		const ref = input.entityRefs[i];
		if (!ref) {
			continue;
		}

		const script = await deps.getBuiltinSandboxScriptBySlug(ref.scriptSlug);
		if (!script) {
			failedIndices.push(i);
			entityIds[i] = null;
			await deps.createImportRunFailure({
				itemIndex: i,
				context: null,
				runId: input.runId,
				sourceLabel: ref.sourceLabel,
				stage: "input_transformation",
				sourceIdentifier: ref.externalId,
				entitySchemaSlug: ref.entitySchemaSlug,
				message: `Sandbox script not found for slug: ${ref.scriptSlug}`,
			});
			await job.updateData({
				...baseSnapshot,
				providerEntityIndex: i + 1,
				providerFailedIndices: failedIndices,
			});
			continue;
		}

		const schema = await deps.getBuiltinEntitySchemaBySlug(ref.entitySchemaSlug);
		if (!schema) {
			failedIndices.push(i);
			entityIds[i] = null;
			await deps.createImportRunFailure({
				itemIndex: i,
				context: null,
				runId: input.runId,
				sourceLabel: ref.sourceLabel,
				stage: "input_transformation",
				sourceIdentifier: ref.externalId,
				entitySchemaSlug: ref.entitySchemaSlug,
				message: `Entity schema not found for slug: ${ref.entitySchemaSlug}`,
			});
			await job.updateData({
				...baseSnapshot,
				providerEntityIndex: i + 1,
				providerFailedIndices: failedIndices,
			});
			continue;
		}

		const sandboxChildJobId = `${job.id}_sandbox_entity_${i}`;
		const sandboxAlreadyQueued = i === input.startIndex && input.currentSandboxJobId !== undefined;

		const updatedJobData = {
			...baseSnapshot,
			providerEntityIndex: i,
			providerFailedIndices: failedIndices,
			providerSandboxJobId: sandboxChildJobId,
		};

		const result = await deps.populateGlobalEntity(job, token, {
			updatedJobData,
			sandboxChildJobId,
			scriptId: script.id,
			userId: input.userId,
			sandboxAlreadyQueued,
			entitySchemaId: schema.id,
			externalId: ref.externalId,
		});
		// WaitingChildrenError propagates naturally to pause the job

		if ("error" in result) {
			failedIndices.push(i);
			entityIds[i] = null;
			const failedGroup = input.mediaEntityGroups[i];
			await deps.createImportRunFailure({
				itemIndex: i,
				runId: input.runId,
				stage: "provider_details",
				sourceLabel: ref.sourceLabel,
				message: result.error.message,
				sourceIdentifier: ref.externalId,
				entitySchemaSlug: ref.entitySchemaSlug,
				context: failedGroup
					? {
							skippedEvents: failedGroup.events.length,
							skippedCollections: failedGroup.collectionMemberships.length,
						}
					: null,
			});
		} else {
			const libraryResult = await deps.ensureEntityInLibrary({
				userId: input.userId,
				entityId: result.entity.id,
			});
			if ("error" in libraryResult) {
				failedIndices.push(i);
				entityIds[i] = null;
				await deps.createImportRunFailure({
					itemIndex: i,
					context: null,
					runId: input.runId,
					stage: "database_commit",
					sourceLabel: ref.sourceLabel,
					message: libraryResult.message,
					sourceIdentifier: ref.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
				});
			} else {
				entityIds[i] = result.entity.id;
			}
		}

		await job.updateData({
			...baseSnapshot,
			providerEntityIndex: i + 1,
			providerEntityIds: entityIds,
			providerFailedIndices: failedIndices,
		});
		if (input.onEntityProcessed) {
			await input.onEntityProcessed(input.adapterFailureCount + (i + 1));
		}
	}
	// oxlint-enable no-await-in-loop

	return { entityIds, failedIndices };
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
	deps: MediaProcessorDeps = mediaProcessorDeps,
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

		const key = entityRefKey(group.entityRef);
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
