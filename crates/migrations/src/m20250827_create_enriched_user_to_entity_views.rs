use indoc::indoc;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static ENRICHED_USER_TO_EXERCISE_VIEW_CREATION_SQL: &str = indoc! { r#"
CREATE VIEW
  enriched_user_to_exercise AS
SELECT
  e.lot,
  e.name,
  e.level,
  e.force,
  e.source,
  e.muscles,
  e.mechanic,
  e.equipment,
  e.id as exercise_id,
  ute.last_updated_on,
  e.created_by_user_id,
  ARRAY_TO_STRING(e.instructions, '\n') AS description,
  ute.exercise_num_times_interacted as num_times_interacted,
  CASE
    WHEN COUNT(cem.origin_collection_id) = 0 THEN ARRAY[]::TEXT[]
    ELSE ARRAY_AGG(DISTINCT cem.origin_collection_id)
  END AS collection_ids
FROM
  exercise e
  LEFT JOIN user_to_entity ute ON ute.exercise_id = e.id
  LEFT JOIN collection_entity_membership cem ON cem.user_id = ute.user_id
  AND cem.entity_id = ute.entity_id
  AND cem.entity_lot = ute.entity_lot
GROUP BY
  e.id,
  e.lot,
  e.name,
  e.level,
  e.force,
  e.source,
  e.muscles,
  e.mechanic,
  e.equipment,
  ute.user_id,
  ute.entity_id,
  ute.last_updated_on,
  e.created_by_user_id,
  ute.exercise_num_times_interacted;
"# };

pub static ENRICHED_USER_TO_PERSON_VIEW_CREATION_SQL: &str = indoc! { r#"
CREATE VIEW
  enriched_user_to_person AS
SELECT
  p.name,
  ute.id,
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
  mg.parts,
  mg.title,
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
SELECT
  m.lot,
  ute.id,
  m.title,
  ute.user_id,
  m.description,
  m.publish_date,
  m.provider_rating,
  ute.last_updated_on,
  COUNT(s.id) AS times_seen,
  ute.entity_id as metadata_id,
  AVG(r.rating) AS average_rating,
  COALESCE(ute.media_reason, ARRAY[]::TEXT[]) AS media_reason,
  CASE
    WHEN COUNT(s.id) = 0 THEN ARRAY[]::TEXT[]
    ELSE ARRAY_AGG(s.state)
  END AS seen_states,
  CASE
    WHEN COUNT(s.id) = 0 THEN NULL
    ELSE MAX(s.finished_on)
  END AS max_seen_finished_on,
  CASE
    WHEN COUNT(s.id) = 0 THEN NULL
    ELSE MAX(s.last_updated_on)
  END AS max_seen_last_updated_on,
  CASE
    WHEN COUNT(cem.origin_collection_id) = 0 THEN ARRAY[]::TEXT[]
    ELSE ARRAY_AGG(DISTINCT cem.origin_collection_id)
  END AS collection_ids
FROM
  user_to_entity ute
  INNER JOIN metadata m ON ute.metadata_id = m.id
  LEFT JOIN review r ON r.user_id = ute.user_id
  AND r.entity_id = ute.entity_id
  AND r.entity_lot = ute.entity_lot
  LEFT JOIN seen s ON s.user_id = ute.user_id
  AND s.metadata_id = ute.metadata_id
  LEFT JOIN collection_entity_membership cem ON cem.user_id = ute.user_id
  AND cem.entity_id = ute.entity_id
  AND cem.entity_lot = ute.entity_lot
WHERE
  ute.metadata_id IS NOT NULL
GROUP BY
  m.lot,
  ute.id,
  m.title,
  ute.user_id,
  ute.entity_id,
  m.description,
  m.publish_date,
  ute.media_reason,
  m.provider_rating,
  ute.last_updated_on;
"# };

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(ENRICHED_USER_TO_EXERCISE_VIEW_CREATION_SQL)
            .await?;
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
