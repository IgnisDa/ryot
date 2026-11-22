import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	mapRowSourceQueryReferences,
	type RowSourcePrecision,
	type RowSourceQuery,
} from "@ryot-app/contract/modules/ryotql/row-source";
import type { SavedViewSubject } from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginId, type SignalSchemaSlug } from "@ryot-app/contract/schema/brands";
import type { Entitlement } from "@ryot-app/contract/schema/entitlement";
import { signalScheduleReadSchemaSlugs } from "@ryot-app/ryotql-recipes/signal-schedules";
import { Array as Arr, Result } from "effect";

import { signalScheduleIssue } from "./row-source-validation";

export type SignalScheduleDefinition = {
	readonly slug: string;
	readonly dueAt: string;
	readonly occurrence: string;
	readonly query: RowSourceQuery;
	readonly signal: SignalSchemaSlug;
	readonly delayDays: null | number;
	readonly subject: SavedViewSubject;
	readonly precision: RowSourcePrecision;
	readonly entitlement: null | Entitlement;
	/** The schema slugs of the global rows the evaluation reads, null when they are not bounded. */
	readonly readSchemaSlugs: null | readonly string[];
	readonly properties: Readonly<Record<string, string>>;
	readonly freshness: null | { readonly confirmedAt: string; readonly maxAgeHours: number };
};

export const materializeSignalSchedule = (
	definition: NonNullable<PluginManifest["signalSchedules"]>[number],
	pluginId: string,
): SignalScheduleDefinition => {
	const schedule: Omit<SignalScheduleDefinition, "readSchemaSlugs"> = {
		slug: definition.slug,
		dueAt: definition.dueAt,
		signal: definition.signal,
		precision: definition.precision,
		occurrence: definition.occurrence,
		properties: definition.properties,
		delayDays: definition.delayDays ?? null,
		freshness: definition.freshness ?? null,
		entitlement: definition.entitlement ?? null,
		query: mapRowSourceQueryReferences(definition.query, (reference) =>
			reference.kind === "self" ? { kind: "local", pluginId: PluginId.make(pluginId) } : reference,
		),
		subject: {
			entityAlias: definition.subject.entityAlias,
			schemas: Arr.map(definition.subject.schemas, ({ slug, owner }) => ({
				slug,
				owner: owner.kind === "self" ? definitionOwner(pluginId) : owner,
			})),
		},
	};
	const issue = signalScheduleIssue(schedule);
	if (issue) {
		throw new Error(`Invalid signal schedule ${definition.slug}: ${issue}`);
	}
	return {
		...schedule,
		readSchemaSlugs: Result.getOrThrow(signalScheduleReadSchemaSlugs(schedule)),
	};
};
