import { dayjs } from "@ryot/ts-utils/dayjs";

import { addToCollection, getOrCreateCollection } from "~/modules/collections";
import {
	ensureEntityInLibrary,
	getEntityIdForUserBySchemaId,
	getUserRelationshipProperties,
	upsertUserRelationship,
} from "~/modules/entities";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas";
import { getBuiltinEventSchemaBySlug } from "~/modules/event-schemas";
import {
	createEventsBestEffortWithTriggers,
	type CreateEventBody,
	type EventWriteContext,
} from "~/modules/events";
import { getBuiltinRelationshipSchemaBySlug } from "~/modules/relationship-schemas";

import { importEntityRefKey, type ImportMediaEntityGroup } from "../jobs";
import { createImportRunFailure } from "../repository";
import { mediaEntityGroupItemIndex } from "./groups";

type MediaEntityWriteDeps = {
	addToCollection: typeof addToCollection;
	ensureEntityInLibrary: typeof ensureEntityInLibrary;
	getOrCreateCollection: typeof getOrCreateCollection;
	upsertUserRelationship: typeof upsertUserRelationship;
	createImportRunFailure: typeof createImportRunFailure;
	getBuiltinEventSchemaBySlug: typeof getBuiltinEventSchemaBySlug;
	getBuiltinEntitySchemaBySlug: typeof getBuiltinEntitySchemaBySlug;
	getEntityIdForUserBySchemaId: typeof getEntityIdForUserBySchemaId;
	getUserRelationshipProperties: typeof getUserRelationshipProperties;
	getBuiltinRelationshipSchemaBySlug: typeof getBuiltinRelationshipSchemaBySlug;
	createEventsBestEffortWithTriggers: typeof createEventsBestEffortWithTriggers;
};

const mediaEntityWriteDeps: MediaEntityWriteDeps = {
	addToCollection,
	ensureEntityInLibrary,
	getOrCreateCollection,
	upsertUserRelationship,
	createImportRunFailure,
	getBuiltinEventSchemaBySlug,
	getBuiltinEntitySchemaBySlug,
	getEntityIdForUserBySchemaId,
	getUserRelationshipProperties,
	getBuiltinRelationshipSchemaBySlug,
	createEventsBestEffortWithTriggers,
};

const libraryEntitySchemaSlug = "library";
const inLibraryRelationshipSchemaSlug = "in-library";
const libraryEntityNotFoundError = "User library entity not found";
const inLibrarySchemaNotFoundError = "in-library relationship schema not found";

type OwnershipWriteState = {
	libraryEntityId?: string | null;
	libraryEntitySchemaId?: string | null;
	inLibraryRelationshipSchemaId?: string | null;
};

type OwnershipWriteDeps = Pick<
	MediaEntityWriteDeps,
	| "ensureEntityInLibrary"
	| "upsertUserRelationship"
	| "getBuiltinEntitySchemaBySlug"
	| "getUserRelationshipProperties"
	| "getEntityIdForUserBySchemaId"
	| "getBuiltinRelationshipSchemaBySlug"
>;

const writeOwnershipToLibrary = async (
	input: { userId: string; entityId: string; provider: string; syncedAt: string },
	state: OwnershipWriteState,
	deps: OwnershipWriteDeps,
): Promise<string | undefined> => {
	const libraryResult = await deps.ensureEntityInLibrary({
		userId: input.userId,
		entityId: input.entityId,
	});
	if ("error" in libraryResult) {
		return libraryResult.message;
	}

	if (state.libraryEntitySchemaId === undefined) {
		const librarySchema = await deps.getBuiltinEntitySchemaBySlug(libraryEntitySchemaSlug);
		state.libraryEntitySchemaId = librarySchema?.id ?? null;
	}
	if (!state.libraryEntitySchemaId) {
		return `Entity schema not found: ${libraryEntitySchemaSlug}`;
	}

	if (state.libraryEntityId === undefined) {
		const libraryEntityIdResult = await deps.getEntityIdForUserBySchemaId({
			userId: input.userId,
			entitySchemaId: state.libraryEntitySchemaId,
		});
		if ("error" in libraryEntityIdResult) {
			return libraryEntityIdResult.message;
		}
		state.libraryEntityId = libraryEntityIdResult.data ?? null;
	}
	if (!state.libraryEntityId) {
		return libraryEntityNotFoundError;
	}

	if (state.inLibraryRelationshipSchemaId === undefined) {
		const relationshipSchema = await deps.getBuiltinRelationshipSchemaBySlug(
			inLibraryRelationshipSchemaSlug,
		);
		state.inLibraryRelationshipSchemaId = relationshipSchema?.id ?? null;
	}
	if (!state.inLibraryRelationshipSchemaId) {
		return inLibrarySchemaNotFoundError;
	}

	const existing =
		(await deps.getUserRelationshipProperties({
			userId: input.userId,
			sourceEntityId: input.entityId,
			targetEntityId: state.libraryEntityId,
			relationshipSchemaId: state.inLibraryRelationshipSchemaId,
		})) ?? {};
	const currentSources = Array.isArray(existing.ownershipSources)
		? existing.ownershipSources.filter((source): source is string => typeof source === "string")
		: [];
	const writeResult = await deps.upsertUserRelationship({
		userId: input.userId,
		sourceEntityId: input.entityId,
		targetEntityId: state.libraryEntityId,
		relationshipSchemaId: state.inLibraryRelationshipSchemaId,
		properties: {
			...existing,
			owned: true,
			ownershipSyncedAt: input.syncedAt,
			ownershipSources: [...new Set([...currentSources, input.provider])],
		},
	});

	return "error" in writeResult ? writeResult.message : undefined;
};

export const writeMediaEntityGroups = async (
	input: {
		runId: string;
		userId: string;
		failedItems: number;
		importedItems: number;
		startGroupIndex: number;
		writeContext?: EventWriteContext;
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
	const collectionIdCache = new Map<string, string>();
	const ownershipWriteState: OwnershipWriteState = {};
	const eventSchemaCache = new Map<string, { id: string }>();

	let failedItems = input.failedItems;
	let importedItems = input.importedItems;

	// oxlint-disable no-await-in-loop
	for (
		let groupIndex = input.startGroupIndex;
		groupIndex < input.entityGroups.length;
		groupIndex++
	) {
		const group = input.entityGroups[groupIndex];
		const itemIndex = mediaEntityGroupItemIndex(group, groupIndex);
		if (!group) {
			await input.onGroupComplete({
				failedItems,
				importedItems,
				nextGroupIndex: groupIndex + 1,
			});
			continue;
		}

		const ref = group.entityRef;
		if (ref.kind !== "resolved") {
			await input.onGroupComplete({ failedItems, importedItems, nextGroupIndex: groupIndex + 1 });
			continue;
		}

		const key = importEntityRefKey(ref);
		const entityId = input.entityIdsByKey.get(key);
		if (!entityId) {
			await input.onGroupComplete({ failedItems, importedItems, nextGroupIndex: groupIndex + 1 });
			continue;
		}
		let groupFailed = false;

		let entitySchemaId = schemaIdCache.get(ref.entitySchemaSlug);
		if (!entitySchemaId) {
			const entitySchema = await deps.getBuiltinEntitySchemaBySlug(ref.entitySchemaSlug);
			if (!entitySchema) {
				failedItems++;
				await deps.createImportRunFailure({
					itemIndex,
					context: null,
					runId: input.runId,
					stage: "database_commit",
					sourceLabel: ref.sourceLabel,
					sourceIdentifier: ref.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
					message: `Entity schema not found: ${ref.entitySchemaSlug}`,
				});
				await input.onGroupComplete({
					failedItems,
					importedItems,
					nextGroupIndex: groupIndex + 1,
				});
				continue;
			}
			entitySchemaId = entitySchema.id;
			schemaIdCache.set(ref.entitySchemaSlug, entitySchemaId);
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
							itemIndex,
							context: null,
							runId: input.runId,
							stage: "database_commit",
							sourceLabel: ref.sourceLabel,
							sourceIdentifier: ref.externalId,
							message: collectionResult.message,
							entitySchemaSlug: ref.entitySchemaSlug,
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
						itemIndex,
						context: null,
						runId: input.runId,
						stage: "database_commit",
						message: addResult.message,
						sourceLabel: ref.sourceLabel,
						sourceIdentifier: ref.externalId,
						entitySchemaSlug: ref.entitySchemaSlug,
					});
				}
			} catch (error) {
				groupFailed = true;
				await deps.createImportRunFailure({
					itemIndex,
					context: null,
					runId: input.runId,
					stage: "database_commit",
					sourceLabel: ref.sourceLabel,
					sourceIdentifier: ref.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
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
						itemIndex,
						context: null,
						runId: input.runId,
						stage: "database_commit",
						sourceLabel: ref.sourceLabel,
						sourceIdentifier: ref.externalId,
						eventSchemaSlug: ev.eventSchemaSlug,
						entitySchemaSlug: ref.entitySchemaSlug,
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

		if (group.ownershipProvider) {
			const ownershipError = await writeOwnershipToLibrary(
				{
					entityId,
					userId: input.userId,
					syncedAt: dayjs().toISOString(),
					provider: group.ownershipProvider,
				},
				ownershipWriteState,
				deps,
			);
			if (ownershipError) {
				groupFailed = true;
				await deps.createImportRunFailure({
					itemIndex,
					context: null,
					runId: input.runId,
					message: ownershipError,
					stage: "database_commit",
					sourceLabel: ref.sourceLabel,
					sourceIdentifier: ref.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
				});
			}
		}

		if (eventInputs.length > 0) {
			const eventResult = await deps.createEventsBestEffortWithTriggers({
				userId: input.userId,
				writeContext: input.writeContext,
				body: eventInputs.map((eventInput) => eventInput.body),
			});
			for (const failure of eventResult.data.failures) {
				const eventInput = eventInputs[failure.itemIndex];
				groupFailed = true;
				await deps.createImportRunFailure({
					itemIndex,
					context: null,
					runId: input.runId,
					stage: "database_commit",
					message: failure.message,
					sourceLabel: ref.sourceLabel,
					sourceIdentifier: ref.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
					eventSchemaSlug: eventInput?.eventSchemaSlug,
				});
			}
		}

		if (groupFailed) {
			failedItems++;
		} else {
			importedItems++;
		}

		await input.onGroupComplete({ failedItems, importedItems, nextGroupIndex: groupIndex + 1 });
	}
	// oxlint-enable no-await-in-loop

	return { failedItems, importedItems };
};
