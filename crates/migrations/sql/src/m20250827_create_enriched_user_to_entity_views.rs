use indoc::indoc;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static ENRICHED_USER_TO_PERSON_VIEW_CREATION_SQL: &str = indoc! { r#"
CREATE VIEW
  enriched_user_to_person AS
SELECT
  p.name,
  ute.id,
  p.source,
  ute.user_id,
  p.description,
  p.id AS person_id,
  p.associated_entity_count,
  CASE
    WHEN COUNT(cem.origin_collection_id) = 0 THEN ARRAY[]::TEXT[]
    ELSE ARRAY_AGG(DISTINCT cem.origin_collection_id)
  END AS collection_ids
FROM
  user_to_entity ute
  INNER JOIN person p ON ute.person_id = p.id
  LEFT JOIN collection_entity_membership cem ON cem.user_id = ute.user_id
  AND cem.entity_id = ute.entity_id
  AND cem.entity_lot = ute.entity_lot
WHERE
  ute.person_id IS NOT NULL
GROUP BY
  p.id,
  p.name,
  ute.id,
  ute.user_id,
  p.description,
  p.associated_entity_count;
"# };

pub static ENRICHED_USER_TO_METADATA_GROUP_VIEW_CREATION_SQL: &str = indoc! { r#"
CREATE VIEW
  enriched_user_to_metadata_group AS
SELECT
  ute.id,
  mg.lot,
  mg.parts,
  mg.title,
  mg.source,
  ute.user_id,
  mg.description,
  mg.id AS metadata_group_id,
  CASE
    WHEN COUNT(cem.origin_collection_id) = 0 THEN ARRAY[]::TEXT[]
    ELSE ARRAY_AGG(DISTINCT cem.origin_collection_id)
  END AS collection_ids
FROM
  user_to_entity ute
  INNER JOIN metadata_group mg ON ute.metadata_group_id = mg.id
  LEFT JOIN collection_entity_membership cem ON cem.user_id = ute.user_id
  AND cem.entity_id = ute.entity_id
  AND cem.entity_lot = ute.entity_lot
WHERE
  ute.metadata_group_id IS NOT NULL
GROUP BY
  mg.id,
  ute.id,
  mg.parts,
  mg.title,
  ute.user_id,
  mg.description;
"# };

pub static ENRICHED_USER_TO_METADATA_VIEW_CREATION_SQL: &str = indoc! { r#"
CREATE VIEW
  enriched_user_to_metadata AS
WITH seen_aggregates AS (
    SELECT
        s.user_id,
        s.metadata_id,
        count(s.id) AS times_seen,
        max(s.finished_on) AS max_seen_finished_on,
        array_agg(DISTINCT s.state) AS seen_states,
        max(s.last_updated_on) AS max_seen_last_updated_on
    FROM seen s
    GROUP BY s.user_id, s.metadata_id
),
review_aggregates AS (
    SELECT
        r.user_id,
        r.entity_id,
        r.entity_lot,
        avg(r.rating) AS average_rating
    FROM review r
    WHERE r.rating IS NOT NULL
    GROUP BY r.user_id, r.entity_id, r.entity_lot
),
collection_aggregates AS (
    SELECT
        cem.user_id,
        cem.entity_id,
        cem.entity_lot,
        array_agg(DISTINCT cem.origin_collection_id) AS collection_ids
    FROM collection_entity_membership cem
    WHERE cem.origin_collection_id IS NOT NULL
    GROUP BY cem.user_id, cem.entity_id, cem.entity_lot
)
SELECT
    m.lot,
    ute.id,
    m.title,
    m.source,
    ute.user_id,
    m.description,
    m.publish_date,
    m.provider_rating,
    ra.average_rating,
    ute.last_updated_on,
    sa.max_seen_finished_on,
    sa.max_seen_last_updated_on,
    ute.entity_id AS metadata_id,
    COALESCE(sa.times_seen, 0::bigint) AS times_seen,
    COALESCE(sa.seen_states, ARRAY[]::text[]) AS seen_states,
    COALESCE(ute.media_reason, ARRAY[]::text[]) AS media_reason,
    COALESCE(ca.collection_ids, ARRAY[]::text[]) AS collection_ids
FROM user_to_entity ute
    JOIN metadata m ON ute.metadata_id = m.id
    LEFT JOIN seen_aggregates sa ON sa.user_id = ute.user_id AND sa.metadata_id = ute.metadata_id
    LEFT JOIN review_aggregates ra ON ra.user_id = ute.user_id AND ra.entity_id = ute.entity_id AND ra.entity_lot = ute.entity_lot
    LEFT JOIN collection_aggregates ca ON ca.user_id = ute.user_id AND ca.entity_id = ute.entity_id AND ca.entity_lot = ute.entity_lot
WHERE ute.metadata_id IS NOT NULL;
"# };

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(ENRICHED_USER_TO_PERSON_VIEW_CREATION_SQL)
            .await?;
        db.execute_unprepared(ENRICHED_USER_TO_METADATA_GROUP_VIEW_CREATION_SQL)
            .await?;
        db.execute_unprepared(ENRICHED_USER_TO_METADATA_VIEW_CREATION_SQL)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
