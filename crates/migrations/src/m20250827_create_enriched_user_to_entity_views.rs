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
  ute.id,
  e.level,
  e.force,
  e.source,
  e.muscles,
  e.mechanic,
  e.equipment,
  ute.last_updated_on,
  e.created_by_user_id,
  ute.entity_id as exercise_id,
  ute.exercise_num_times_interacted as num_times_interacted,
  ARRAY_TO_STRING(
    ARRAY (
      SELECT
        JSONB_ARRAY_ELEMENTS_TEXT(e.attributes -> 'instructions')
    ),
    '\n'
  ) AS description,
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
  e.lot,
  e.name,
  ute.id,
  e.level,
  e.force,
  e.source,
  e.muscles,
  e.mechanic,
  e.equipment,
  ute.user_id,
  e.attributes,
  ute.entity_id,
  ute.last_updated_on,
  e.created_by_user_id,
  ute.exercise_num_times_interacted;
"# };

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(ENRICHED_USER_TO_EXERCISE_VIEW_CREATION_SQL)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
