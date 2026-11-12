import type { FieldSelection, RowSelection } from "@ryot-app/contract/modules/ryotql/language";
import type { AccessClass } from "@ryot-app/contract/oauth";

export type RyotQLAudience = "kernel" | "plugin";

export type CatalogFieldKind = "date" | "json" | "text" | "number" | "boolean";

export type CatalogField = {
	readonly nullable: boolean;
	readonly demoReadable?: false;
	readonly kind: CatalogFieldKind;
	readonly publicationReadable?: false;
	readonly access?: "admin" | "kernel" | "publication";
};

export type RyotQLAccess =
	| { readonly type: "admin" }
	| { readonly type: "plugin" }
	| { readonly type: "publication" }
	| { readonly type: "user"; readonly audience: RyotQLAudience; readonly accessClass: AccessClass };

export type CatalogTable<Field extends CatalogField = CatalogField> = {
	readonly visibility: CatalogVisibility;
	// Small per-user catalogs: an include reads one materialized copy instead of re-evaluating the
	// view for every parent row.
	readonly materializedInIncludes?: true;
	readonly fields: Readonly<Record<string, Field>>;
	readonly primaryKey: readonly [string, ...string[]];
};

type CatalogVisibility = {
	readonly admin?: true;
	readonly plugin?: true;
	readonly publication?: true;
	readonly user?: { readonly demoReadable?: false; readonly pluginReadable: boolean };
};

export const catalogTables = {
	oauthConnection: {
		primaryKey: ["id"],
		visibility: { user: { demoReadable: false, pluginReadable: false } },
		fields: { id: { kind: "text", nullable: false }, status: { kind: "text", nullable: false } },
	},
	importIssue: {
		primaryKey: ["runId", "id"],
		visibility: { user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			data: { kind: "json", nullable: false },
			runId: { kind: "text", nullable: false },
		},
	},
	migrationReportDetail: {
		primaryKey: ["seq"],
		visibility: { admin: true },
		fields: {
			seq: { kind: "number", nullable: false },
			detail: { kind: "json", nullable: false },
			createdAt: { kind: "date", nullable: false },
			reportSeq: { kind: "number", nullable: false },
		},
	},
	eventScope: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			entityId: { kind: "text", nullable: false },
			revision: { kind: "number", nullable: false },
			eventSchemaPluginId: { kind: "text", nullable: true },
		},
	},
	sandboxProviderOperation: {
		primaryKey: ["providerId", "operation"],
		visibility: { user: { pluginReadable: true } },
		fields: {
			pluginId: { kind: "text", nullable: false },
			operation: { kind: "text", nullable: false },
			packageId: { kind: "text", nullable: false },
			providerId: { kind: "text", nullable: false },
			optionsSchema: { kind: "json", nullable: true },
		},
	},
	notificationChannel: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			channel: { kind: "text", nullable: false },
			createdAt: { kind: "date", nullable: false },
			updatedAt: { kind: "date", nullable: false },
			description: { kind: "text", nullable: false },
			isDisabled: { kind: "boolean", nullable: false },
		},
	},
	notification: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: false } },
		fields: {
			id: { kind: "text", nullable: false },
			reason: { kind: "text", nullable: true },
			state: { kind: "text", nullable: false },
			outcome: { kind: "text", nullable: true },
			settledAt: { kind: "date", nullable: true },
			createdAt: { kind: "date", nullable: false },
			reminderId: { kind: "text", nullable: true },
		},
	},
	entityTranslation: {
		visibility: { admin: true },
		primaryKey: ["entityId", "language"],
		fields: {
			name: { kind: "text", nullable: true },
			language: { kind: "text", nullable: false },
			entityId: { kind: "text", nullable: false },
			properties: { kind: "json", nullable: true },
			createdAt: { kind: "date", nullable: false },
			updatedAt: { kind: "date", nullable: false },
			populatedAt: { kind: "date", nullable: true },
		},
	},
	publicationLink: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: false } },
		fields: {
			id: { kind: "text", nullable: false },
			label: { kind: "text", nullable: false },
			expiresAt: { kind: "date", nullable: true },
			revokedAt: { kind: "date", nullable: true },
			createdAt: { kind: "date", nullable: false },
			publicationId: { kind: "text", nullable: false },
			lastExchangedAt: { kind: "date", nullable: true },
		},
	},
	notificationSubscription: {
		primaryKey: ["id"],
		visibility: { admin: true, user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			createdAt: { kind: "date", nullable: false },
			updatedAt: { kind: "date", nullable: false },
			isActive: { kind: "boolean", nullable: false },
			signalSchemaSlug: { kind: "text", nullable: false },
			signalSchemaPluginId: { kind: "text", nullable: true },
			userId: { kind: "text", nullable: false, access: "admin" },
		},
	},
	userLifecycleOperation: {
		primaryKey: ["id"],
		visibility: { admin: true },
		fields: {
			id: { kind: "text", nullable: false },
			kind: { kind: "text", nullable: false },
			failure: { kind: "json", nullable: true },
			status: { kind: "text", nullable: false },
			userId: { kind: "text", nullable: false },
			startedAt: { kind: "date", nullable: true },
			finishedAt: { kind: "date", nullable: true },
			createdAt: { kind: "date", nullable: false },
			resetResult: { kind: "json", nullable: true },
		},
	},
	migrationReport: {
		primaryKey: ["seq"],
		visibility: { admin: true },
		fields: {
			code: { kind: "text", nullable: true },
			seq: { kind: "number", nullable: false },
			level: { kind: "text", nullable: false },
			phase: { kind: "text", nullable: false },
			count: { kind: "number", nullable: true },
			message: { kind: "text", nullable: false },
			createdAt: { kind: "date", nullable: false },
			totalDetails: { kind: "number", nullable: true },
			elapsedSeconds: { kind: "number", nullable: true },
		},
	},
	sandboxScript: {
		primaryKey: ["id"],
		visibility: { admin: true },
		fields: {
			id: { kind: "text", nullable: false },
			slug: { kind: "text", nullable: false },
			name: { kind: "text", nullable: false },
			metadata: { kind: "json", nullable: false },
			providerId: { kind: "text", nullable: true },
			createdAt: { kind: "date", nullable: false },
			contentHash: { kind: "text", nullable: false },
			pluginRevisionId: { kind: "text", nullable: true },
			compiledFormat: { kind: "number", nullable: false },
		},
	},
	notificationDelivery: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: false } },
		fields: {
			id: { kind: "text", nullable: false },
			reason: { kind: "text", nullable: true },
			status: { kind: "text", nullable: false },
			channel: { kind: "text", nullable: false },
			claimedAt: { kind: "date", nullable: true },
			settledAt: { kind: "date", nullable: true },
			channelId: { kind: "text", nullable: false },
			description: { kind: "text", nullable: false },
			notificationId: { kind: "text", nullable: false },
		},
	},
	eventSchema: {
		primaryKey: ["id"],
		materializedInIncludes: true,
		visibility: { plugin: true, publication: true, user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			slug: { kind: "text", nullable: false },
			name: { kind: "text", nullable: false },
			pluginId: { kind: "text", nullable: true },
			packageId: { kind: "text", nullable: true },
			pluginRevisionId: { kind: "text", nullable: true },
			propertiesSchema: { kind: "json", nullable: false },
			entitySchemaSlug: { kind: "text", nullable: false },
		},
	},
	signalSchema: {
		primaryKey: ["id"],
		visibility: { plugin: true, user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			slug: { kind: "text", nullable: false },
			name: { kind: "text", nullable: false },
			pluginId: { kind: "text", nullable: true },
			packageId: { kind: "text", nullable: true },
			catalogState: { kind: "text", nullable: false },
			audiencePolicy: { kind: "json", nullable: false },
			pluginRevisionId: { kind: "text", nullable: true },
			propertiesSchema: { kind: "json", nullable: false },
		},
	},
	sandboxProvider: {
		primaryKey: ["id"],
		materializedInIncludes: true,
		visibility: { user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			slug: { kind: "text", nullable: false },
			name: { kind: "text", nullable: false },
			pluginId: { kind: "text", nullable: false },
			packageId: { kind: "text", nullable: false },
			createdAt: { kind: "date", nullable: false },
			updatedAt: { kind: "date", nullable: false },
			information: { kind: "json", nullable: false },
			rootEntitySchemaSlug: { kind: "text", nullable: false },
		},
	},
	publication: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: false } },
		fields: {
			id: { kind: "text", nullable: false },
			icon: { kind: "text", nullable: false },
			title: { kind: "text", nullable: false },
			source: { kind: "json", nullable: false },
			revokedAt: { kind: "date", nullable: true },
			createdAt: { kind: "date", nullable: false },
			updatedAt: { kind: "date", nullable: false },
			description: { kind: "text", nullable: true },
			revision: { kind: "number", nullable: false },
			showOwnerName: { kind: "boolean", nullable: false },
		},
	},
	backupRun: {
		primaryKey: ["id"],
		visibility: { user: { demoReadable: false, pluginReadable: false } },
		fields: {
			id: { kind: "text", nullable: false },
			kind: { kind: "text", nullable: false },
			failure: { kind: "json", nullable: true },
			status: { kind: "text", nullable: false },
			startedAt: { kind: "date", nullable: true },
			expiresAt: { kind: "date", nullable: true },
			finishedAt: { kind: "date", nullable: true },
			createdAt: { kind: "date", nullable: false },
			progress: { kind: "number", nullable: false },
			artifactProvider: { kind: "text", nullable: true },
		},
	},
	relationshipSchema: {
		primaryKey: ["id"],
		visibility: { plugin: true, publication: true, user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			slug: { kind: "text", nullable: false },
			name: { kind: "text", nullable: false },
			pluginId: { kind: "text", nullable: true },
			packageId: { kind: "text", nullable: true },
			userWritePolicy: { kind: "text", nullable: true },
			pluginRevisionId: { kind: "text", nullable: true },
			propertiesSchema: { kind: "json", nullable: false },
			sourceEntitySchemaSlug: { kind: "text", nullable: true },
			targetEntitySchemaSlug: { kind: "text", nullable: true },
		},
	},
	calendarSource: {
		primaryKey: ["pluginId", "slug"],
		visibility: { user: { pluginReadable: true } },
		fields: {
			art: { kind: "text", nullable: true },
			done: { kind: "text", nullable: true },
			icon: { kind: "text", nullable: false },
			name: { kind: "text", nullable: false },
			slug: { kind: "text", nullable: false },
			query: { kind: "json", nullable: false },
			caption: { kind: "text", nullable: true },
			subject: { kind: "json", nullable: false },
			startAt: { kind: "text", nullable: false },
			pluginId: { kind: "text", nullable: false },
			precision: { kind: "text", nullable: false },
			isHidden: { kind: "boolean", nullable: false },
		},
	},
	user: {
		primaryKey: ["id"],
		visibility: { admin: true, user: { pluginReadable: false } },
		fields: {
			id: { kind: "text", nullable: false },
			image: { kind: "text", nullable: true },
			name: { kind: "text", nullable: false },
			email: { kind: "text", nullable: false },
			createdAt: { kind: "date", nullable: false },
			preferences: { kind: "json", nullable: false },
			disabledAt: { kind: "date", nullable: true, access: "admin" },
			authState: { kind: "text", nullable: false, access: "admin" },
			twoFactorEnabled: { nullable: true, kind: "boolean", access: "admin" },
			twoFactorStatus: { kind: "json", nullable: false, access: "kernel", demoReadable: false },
		},
	},
	entitySchema: {
		primaryKey: ["id"],
		visibility: { plugin: true, publication: true, user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			slug: { kind: "text", nullable: false },
			name: { kind: "text", nullable: false },
			icon: { kind: "text", nullable: false },
			editor: { kind: "json", nullable: true },
			browse: { kind: "json", nullable: true },
			pluginId: { kind: "text", nullable: true },
			packageId: { kind: "text", nullable: true },
			userState: { kind: "json", nullable: true },
			pluginRevisionId: { kind: "text", nullable: true },
			propertiesSchema: { kind: "json", nullable: false },
			mergeIdentityProperties: { kind: "json", nullable: false },
		},
	},
	relationship: {
		primaryKey: ["id"],
		visibility: { admin: true, plugin: true, publication: true, user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			createdAt: { kind: "date", nullable: false },
			properties: { kind: "json", nullable: false },
			sourceEntityId: { kind: "text", nullable: false },
			targetEntityId: { kind: "text", nullable: false },
			collectionRank: { kind: "number", nullable: true },
			relationshipSchemaSlug: { kind: "text", nullable: false },
			relationshipSchemaPluginId: { kind: "text", nullable: true },
			userId: { kind: "text", nullable: true, publicationReadable: false },
			projection: { kind: "json", nullable: true, publicationReadable: false },
			projectionStatus: { kind: "text", nullable: false, publicationReadable: false },
		},
	},
	event: {
		primaryKey: ["id"],
		visibility: { plugin: true, publication: true, user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			userId: { kind: "text", nullable: false },
			entityId: { kind: "text", nullable: false },
			orderKey: { kind: "text", nullable: false },
			createdAt: { kind: "date", nullable: false },
			updatedAt: { kind: "date", nullable: false },
			projection: { kind: "json", nullable: true },
			revision: { kind: "number", nullable: false },
			properties: { kind: "json", nullable: false },
			occurredAt: { kind: "date", nullable: false },
			sessionEntityId: { kind: "text", nullable: true },
			orderCreatedAt: { kind: "date", nullable: false },
			eventSchemaSlug: { kind: "text", nullable: false },
			projectionStatus: { kind: "text", nullable: false },
			eventSchemaPluginId: { kind: "text", nullable: true },
		},
	},
	importRun: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			source: { kind: "text", nullable: false },
			status: { kind: "text", nullable: false },
			summary: { kind: "json", nullable: false },
			startedAt: { kind: "date", nullable: true },
			finishedAt: { kind: "date", nullable: true },
			createdAt: { kind: "date", nullable: false },
			updatedAt: { kind: "date", nullable: false },
			activities: { kind: "json", nullable: false },
			expiryReason: { kind: "text", nullable: true },
			blockDeadline: { kind: "date", nullable: true },
			failureReason: { kind: "json", nullable: true },
			integrationId: { kind: "text", nullable: true },
			blockReasons: { kind: "json", nullable: false },
			inputSummary: { kind: "json", nullable: false },
			pluginInstallationId: { kind: "text", nullable: true },
		},
	},
	importSource: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: false } },
		fields: {
			id: { kind: "text", nullable: false },
			plan: { kind: "json", nullable: true },
			slug: { kind: "text", nullable: false },
			name: { kind: "text", nullable: false },
			pluginId: { kind: "text", nullable: true },
			packageId: { kind: "text", nullable: true },
			exportHelp: { kind: "json", nullable: true },
			pluginScope: { kind: "text", nullable: true },
			description: { kind: "text", nullable: false },
			inputSchema: { kind: "json", nullable: false },
			workflowSlug: { kind: "text", nullable: false },
			installationId: { kind: "text", nullable: true },
			isStartable: { kind: "boolean", nullable: false },
			readinessMetadata: { kind: "json", nullable: true },
			missingPluginConfigKeys: { kind: "json", nullable: false },
			requiredPluginConfigKeys: { kind: "json", nullable: false },
		},
	},
	reminder: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: false } },
		fields: {
			id: { kind: "text", nullable: false },
			dueAt: { kind: "date", nullable: true },
			reason: { kind: "text", nullable: true },
			state: { kind: "text", nullable: false },
			message: { kind: "text", nullable: true },
			outcome: { kind: "text", nullable: true },
			timezone: { kind: "text", nullable: true },
			entityId: { kind: "text", nullable: true },
			settledAt: { kind: "date", nullable: true },
			removedAt: { kind: "date", nullable: true },
			createdAt: { kind: "date", nullable: false },
			updatedAt: { kind: "date", nullable: false },
			entityTitle: { kind: "text", nullable: true },
			revision: { kind: "number", nullable: false },
			processingAt: { kind: "date", nullable: true },
			replacementId: { kind: "text", nullable: true },
			parentEntityId: { kind: "text", nullable: true },
			originalSchedule: { kind: "json", nullable: true },
		},
	},
	integrationProvider: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: false } },
		fields: {
			id: { kind: "text", nullable: false },
			plan: { kind: "json", nullable: true },
			lot: { kind: "text", nullable: false },
			slug: { kind: "text", nullable: false },
			name: { kind: "text", nullable: false },
			pluginId: { kind: "text", nullable: true },
			packageId: { kind: "text", nullable: true },
			scriptSlug: { kind: "text", nullable: true },
			pluginScope: { kind: "text", nullable: true },
			description: { kind: "text", nullable: false },
			hasScript: { kind: "boolean", nullable: false },
			installationId: { kind: "text", nullable: true },
			settingsSchema: { kind: "json", nullable: false },
			readinessMetadata: { kind: "json", nullable: true },
			requiresProKey: { kind: "boolean", nullable: false },
			readinessConnections: { kind: "json", nullable: false },
			supportsOwnershipSync: { kind: "boolean", nullable: false },
		},
	},
	integration: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			name: { kind: "text", nullable: true },
			lot: { kind: "text", nullable: false },
			pluginId: { kind: "text", nullable: true },
			packageId: { kind: "text", nullable: true },
			provider: { kind: "text", nullable: false },
			createdAt: { kind: "date", nullable: false },
			updatedAt: { kind: "date", nullable: false },
			lastFinishedAt: { kind: "date", nullable: true },
			isDisabled: { kind: "boolean", nullable: false },
			extraSettings: { kind: "json", nullable: false },
			syncOwnership: { kind: "boolean", nullable: false },
			minimumProgress: { kind: "number", nullable: false },
			maximumProgress: { kind: "number", nullable: false },
			webhookToken: { kind: "text", nullable: true, access: "kernel", demoReadable: false },
			providerSpecifics: { kind: "json", nullable: false, access: "kernel", demoReadable: false },
		},
	},
	page: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: false } },
		fields: {
			id: { kind: "text", nullable: false },
			slug: { kind: "text", nullable: false },
			name: { kind: "text", nullable: false },
			origin: { kind: "text", nullable: false },
			createdAt: { kind: "date", nullable: false },
			updatedAt: { kind: "date", nullable: false },
			writeAccess: { kind: "boolean", nullable: false },
			draftRevision: { kind: "number", nullable: false },
			draftDefinition: { kind: "json", nullable: false },
			draftArtifactHash: { kind: "text", nullable: true },
			publishedRevision: { kind: "number", nullable: true },
			publishedDefinition: { kind: "json", nullable: true },
			authorityRevision: { kind: "number", nullable: false },
			draftDefinitionHash: { kind: "text", nullable: false },
			publishedArtifactHash: { kind: "text", nullable: true },
			draftCompiledRevision: { kind: "number", nullable: true },
			publishedDefinitionHash: { kind: "text", nullable: true },
		},
	},
	pluginInstallation: {
		primaryKey: ["id"],
		visibility: { admin: true, user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			health: { kind: "text", nullable: false },
			pluginId: { kind: "text", nullable: false },
			createdAt: { kind: "date", nullable: false },
			updatedAt: { kind: "date", nullable: false },
			healthReason: { kind: "text", nullable: true },
			isHidden: { kind: "boolean", nullable: false },
			sortOrder: { kind: "number", nullable: false },
			homeSavedView: { kind: "json", nullable: true },
			isInitialized: { kind: "boolean", nullable: false },
			incompatibilityReason: { kind: "text", nullable: true },
			config: { kind: "json", nullable: false, access: "kernel" },
			conflictingSystemPluginId: { kind: "text", nullable: true },
			userSettings: { kind: "json", nullable: false, access: "kernel" },
			configuredSecrets: { kind: "json", nullable: false, access: "kernel" },
			activeConfigRevisionId: { kind: "text", nullable: true, access: "admin" },
		},
	},
	plugin: {
		primaryKey: ["id"],
		visibility: { admin: true, publication: true, user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			icon: { kind: "text", nullable: true },
			name: { kind: "text", nullable: true },
			scope: { kind: "text", nullable: false },
			status: { kind: "text", nullable: false },
			version: { kind: "text", nullable: true },
			packageId: { kind: "text", nullable: false },
			ingestedAt: { kind: "date", nullable: true },
			description: { kind: "text", nullable: true },
			contentHash: { kind: "text", nullable: true },
			configSchema: { kind: "json", nullable: true },
			activationId: { kind: "text", nullable: false },
			clientEntities: { kind: "json", nullable: true },
			activeRevisionId: { kind: "text", nullable: true },
			clientApiVersion: { kind: "number", nullable: true },
			userSettingsSchema: { kind: "json", nullable: true },
			clientCollectionPages: { kind: "json", nullable: true },
			environmentConfigRevisionId: { kind: "text", nullable: true, access: "admin" },
		},
	},
	savedView: {
		primaryKey: ["id"],
		visibility: { user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			sort: { kind: "text", nullable: true },
			slug: { kind: "text", nullable: false },
			name: { kind: "text", nullable: false },
			icon: { kind: "text", nullable: false },
			filter: { kind: "json", nullable: true },
			pluginId: { kind: "text", nullable: true },
			packageId: { kind: "text", nullable: true },
			createdAt: { kind: "date", nullable: true },
			updatedAt: { kind: "date", nullable: true },
			renderer: { kind: "json", nullable: false },
			settings: { kind: "json", nullable: false },
			arguments: { kind: "json", nullable: false },
			reference: { kind: "json", nullable: false },
			dataSources: { kind: "json", nullable: true },
			revision: { kind: "number", nullable: false },
			isHidden: { kind: "boolean", nullable: false },
			sortOrder: { kind: "number", nullable: false },
			isBuiltin: { kind: "boolean", nullable: false },
			pluginInstallationId: { kind: "text", nullable: true },
		},
	},
	entity: {
		primaryKey: ["id"],
		visibility: { plugin: true, publication: true, user: { pluginReadable: true } },
		fields: {
			id: { kind: "text", nullable: false },
			name: { kind: "text", nullable: false },
			occursAt: { kind: "date", nullable: true },
			externalId: { kind: "text", nullable: true },
			providerId: { kind: "text", nullable: true },
			createdAt: { kind: "date", nullable: false },
			updatedAt: { kind: "date", nullable: false },
			properties: { kind: "json", nullable: false },
			populatedAt: { kind: "date", nullable: true },
			populationStatus: { kind: "json", nullable: false },
			entitySchemaSlug: { kind: "text", nullable: false },
			providerCheckedAt: { kind: "date", nullable: true },
			translationStatus: { kind: "json", nullable: false },
			entitySchemaPluginId: { kind: "text", nullable: true },
			relatedPopulationStatus: { kind: "json", nullable: false },
			collectionOrderRevision: { kind: "number", nullable: false },
			userId: { kind: "text", nullable: true, publicationReadable: false },
			publicationRank: { kind: "number", nullable: false, access: "publication" },
		},
	},
} as const satisfies Readonly<Record<string, CatalogTable>>;

export type CatalogTableName = keyof typeof catalogTables;

export const jsonElementsTable = {
	visibility: {},
	primaryKey: ["ordinal"],
	fields: { value: { kind: "json", nullable: true }, ordinal: { kind: "number", nullable: false } },
} as const satisfies CatalogTable;

export const SOURCE_ENTITY_TABLE_PREFIX = "sourceEntity:";

export const sourceEntityTable = {
	primaryKey: ["rank"],
	visibility: { user: { pluginReadable: true } },
	fields: {
		rank: { kind: "number", nullable: false },
		entityId: { kind: "text", nullable: false },
	},
} as const satisfies CatalogTable;

const isCatalogTableName = (name: string): name is CatalogTableName =>
	Object.hasOwn(catalogTables, name);

export const getCatalogTable = (name: string): undefined | CatalogTable => {
	if (isCatalogTableName(name)) {
		return catalogTables[name];
	}
	return name.startsWith(SOURCE_ENTITY_TABLE_PREFIX) ? sourceEntityTable : undefined;
};

export const canAccessCatalogTable = (table: CatalogTable, access: RyotQLAccess) => {
	if (access.type === "admin") {
		return table.visibility.admin !== undefined;
	}
	if (access.type === "publication") {
		return table.visibility.publication !== undefined;
	}
	if (access.type === "plugin") {
		return table.visibility.plugin !== undefined;
	}
	const policy = table.visibility.user;
	return (
		policy !== undefined &&
		(access.audience === "kernel" || policy.pluginReadable) &&
		(access.accessClass !== "demo" || policy.demoReadable !== false)
	);
};

const canAccessCatalogField = (field: CatalogField, access: RyotQLAccess) => {
	if (access.type === "publication") {
		return (
			field.access === "publication" ||
			(field.access === undefined && field.publicationReadable !== false)
		);
	}
	return (
		field.access !== "publication" &&
		(access.type !== "user" || access.accessClass !== "demo" || field.demoReadable !== false) &&
		(field.access === undefined ||
			access.type === "admin" ||
			(field.access === "kernel" && access.type === "user" && access.audience === "kernel"))
	);
};

export const resolveCatalogField = <Field extends CatalogField>(
	table: CatalogTable<Field>,
	name: string,
	access: RyotQLAccess,
): Field | undefined => {
	const field = Object.hasOwn(table.fields, name) ? table.fields[name] : undefined;
	return field && canAccessCatalogField(field, access) ? field : undefined;
};

export const expandCatalogSelections = (
	selections: readonly RowSelection[],
	resolveTable: (alias: string) => undefined | CatalogTable,
	access: RyotQLAccess,
): { readonly error: null | string; readonly fields: FieldSelection[] } => {
	const fields: FieldSelection[] = [];
	for (const selection of selections) {
		if ("key" in selection) {
			fields.push(selection);
			continue;
		}
		const table = resolveTable(selection.tableAlias);
		if (!table) {
			return { fields: [], error: `Unknown table alias '${selection.tableAlias}'` };
		}
		for (const [field, definition] of Object.entries(table.fields)) {
			if (canAccessCatalogField(definition, access)) {
				fields.push({
					key: field,
					expr: { field, type: "column", tableAlias: selection.tableAlias },
				});
			}
		}
	}
	return { fields, error: null };
};
