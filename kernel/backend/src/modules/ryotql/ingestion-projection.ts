import { sql } from "drizzle-orm";

export const ingestionActivitiesSql = (alias: string) => sql`(
 SELECT coalesce(jsonb_agg(activity.data ORDER BY activity.id), '[]'::jsonb)
 FROM import_activity activity WHERE activity.run_id = ${sql.raw(alias)}.id
)`;

export const ingestionSummarySql = (alias: string) => sql`(
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'unit', outcomes.unit, 'recordKind', outcomes.record_kind,
  'counts', jsonb_build_object('created', outcomes.created, 'updated', outcomes.updated,
   'unchanged', outcomes.unchanged, 'skipped', outcomes.skipped, 'unsuccessful', outcomes.unsuccessful)
 ) ORDER BY outcomes.record_kind, outcomes.unit), '[]'::jsonb)
 FROM (
  SELECT item->>'unit' AS unit, item->>'recordKind' AS record_kind,
   sum((item->'counts'->>'created')::bigint) AS created,
   sum((item->'counts'->>'updated')::bigint) AS updated,
   sum((item->'counts'->>'unchanged')::bigint) AS unchanged,
   sum((item->'counts'->>'skipped')::bigint) AS skipped,
   sum((item->'counts'->>'unsuccessful')::bigint) AS unsuccessful
  FROM import_batch batch CROSS JOIN LATERAL jsonb_array_elements(batch.data->'summary') item
  WHERE batch.run_id = ${sql.raw(alias)}.id
  GROUP BY item->>'recordKind', item->>'unit'
 ) outcomes
)`;
