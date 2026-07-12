import type { IncludeEntry } from "@ryot/contract/modules/query-engine/language";
import { sql } from "drizzle-orm";

import { compileBool, compileOrderBySql } from "./expr";
import { entitySourceSql, rowVisibleSql, type SqlFragment } from "./fragments";
import type { CompileScope, SqlRef } from "./scope";
import { jsonbFieldEntriesSql } from "./select-list";

// Per include: the LATERAL joins to add to the enclosing FROM, and two ways to reference each
// include's aggregated array — as a top-level SELECT column (`<key>__inc`) or as a jsonb_build_object
// entry when nesting inside a parent include's child object.
export type CompiledIncludes = {
	readonly count: number;
	readonly laterals: SqlFragment;
	readonly columns: SqlFragment;
	readonly entries: SqlFragment;
};

const EMPTY: CompiledIncludes = { count: 0, laterals: sql``, columns: sql``, entries: sql`` };

const slugListSql = (schemas: readonly string[]): SqlFragment =>
	sql.join(
		schemas.map((slug) => sql`${slug}`),
		sql`, `,
	);

const whereTail = (where: SqlFragment | null): SqlFragment => (where ? sql`AND ${where}` : sql``);

// A single include's correlated LATERAL producing `items` = an ordered jsonb array of child objects,
// each an `{ <key>__v, <key>__k, <childKey>__inc }` object built from the projected fields and any
// nested includes. `parentAlias` is the SQL alias of the entity this include hangs off of.
const compileInclude = (
	include: IncludeEntry,
	scope: CompileScope,
	parentAlias: string,
): { lateral: SqlFragment; incAlias: string } | null => {
	const source = include.source;
	const suffix = scope.freshSuffix();
	const inc = `inc${suffix}`;
	const rows = `s${suffix}`;
	const executionScope = scope.executionScope;

	if (source.type === "events") {
		const ev = `iev${suffix}`;
		const childScope = scope.child(
			new Map<string, SqlRef>([
				[source.alias, { kind: "event", sqlAlias: ev, schemas: source.schemas }],
			]),
		);
		const order = compileOrderBySql(include.orderBy, childScope);
		const childObject = sql`jsonb_build_object(${jsonbFieldEntriesSql(include.fields, childScope)})`;
		const where = source.where ? compileBool(source.where, childScope) : null;
		const lateral = sql`
			LEFT JOIN LATERAL (
				SELECT COALESCE(jsonb_agg(${sql.raw(rows)}.child ORDER BY ${sql.raw(rows)}."__rn"), '[]'::jsonb) AS items
				FROM (
					SELECT ${childObject} AS child, row_number() OVER (ORDER BY ${order}) AS "__rn"
					FROM event ${sql.raw(ev)}
					WHERE ${sql.raw(ev)}.entity_id = ${sql.raw(parentAlias)}.id
						AND ${rowVisibleSql("event", ev, executionScope)}
						AND ${sql.raw(ev)}.event_schema_slug IN (${slugListSql(source.schemas)})
						${whereTail(where)}
					ORDER BY ${order}
					LIMIT ${include.limit + 1}
				) ${sql.raw(rows)}
			) ${sql.raw(inc)} ON true`;
		return { lateral, incAlias: inc };
	}

	if (source.via === undefined) {
		return null;
	}
	const via = source.via;
	const e = `ie${suffix}`;
	const r = `ir${suffix}`;
	const anchorColumn = via.direction === "outgoing" ? "source_entity_id" : "target_entity_id";
	const childColumn = via.direction === "outgoing" ? "target_entity_id" : "source_entity_id";
	const childScope = scope.child(
		new Map<string, SqlRef>([
			[source.alias, { kind: "entity", sqlAlias: e, schemas: source.schemas }],
			[via.alias, { kind: "relationship", sqlAlias: r, schemas: [via.schema] }],
		]),
	);
	const nested = compileIncludes(include.include ?? [], childScope, e);
	const order = compileOrderBySql(include.orderBy, childScope);
	const fieldEntries = jsonbFieldEntriesSql(include.fields, childScope);
	const objectEntries = nested.count > 0 ? sql`${fieldEntries}, ${nested.entries}` : fieldEntries;
	const where = source.where ? compileBool(source.where, childScope) : null;
	const endpoint = via.direction === "outgoing" ? "target" : "source";
	const lateral = sql`
		LEFT JOIN LATERAL (
			SELECT COALESCE(jsonb_agg(${sql.raw(rows)}.child ORDER BY ${sql.raw(rows)}."__rn"), '[]'::jsonb) AS items
			FROM (
				SELECT jsonb_build_object(${objectEntries}) AS child, row_number() OVER (ORDER BY ${order}) AS "__rn"
				FROM relationship ${sql.raw(r)}
				JOIN ${entitySourceSql(scope.language)} ${sql.raw(e)} ON ${sql.raw(e)}.id = ${sql.raw(`${r}.${childColumn}`)}
				${nested.laterals}
				WHERE ${sql.raw(`${r}.${anchorColumn}`)} = ${sql.raw(parentAlias)}.id
					AND ${sql.raw(r)}.relationship_schema_slug = ${via.schema}
					AND ${sql.raw(e)}.entity_schema_slug IN (${slugListSql(source.schemas)})
					AND ${rowVisibleSql("relationship", r, executionScope)}
					AND ${rowVisibleSql("entity", e, executionScope, {
						type: "relationshipEndpoint",
						endpoint,
						relationshipSchemaSlugs: [via.schema],
					})}
					${whereTail(where)}
				ORDER BY ${order}
				LIMIT ${include.limit + 1}
			) ${sql.raw(rows)}
		) ${sql.raw(inc)} ON true`;
	return { lateral, incAlias: inc };
};

// Compiles a list of includes hanging off `parentAlias` into their LATERAL joins plus the SELECT
// columns / jsonb entries that expose each include's ordered child array.
export const compileIncludes = (
	includes: readonly IncludeEntry[],
	scope: CompileScope,
	parentAlias: string,
): CompiledIncludes => {
	if (includes.length === 0) {
		return EMPTY;
	}
	const laterals: SqlFragment[] = [];
	const columns: SqlFragment[] = [];
	const entries: SqlFragment[] = [];
	for (const include of includes) {
		const compiled = compileInclude(include, scope, parentAlias);
		if (!compiled) {
			continue;
		}
		laterals.push(compiled.lateral);
		columns.push(sql`${sql.raw(compiled.incAlias)}.items AS ${sql.raw(`"${include.key}__inc"`)}`);
		entries.push(sql.raw(`'${include.key.replace(/'/g, "''")}__inc'`));
		entries.push(sql`${sql.raw(compiled.incAlias)}.items`);
	}
	return {
		count: columns.length,
		laterals: sql.join(laterals, sql` `),
		columns: sql.join(columns, sql`, `),
		entries: sql.join(entries, sql`, `),
	};
};
