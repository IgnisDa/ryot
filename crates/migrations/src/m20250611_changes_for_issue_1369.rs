use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
            UPDATE user_to_entity
            SET exercise_extra_information = jsonb_set(
                exercise_extra_information,
                '{history}',
                (
                    SELECT jsonb_agg(
                        jsonb_set(history_elem, '{num_sets}', 'null'::jsonb, true)
                    )
                    FROM jsonb_array_elements(exercise_extra_information->'history') AS history_elem
                ),
                true
            )
            WHERE exercise_extra_information IS NOT NULL
                AND exercise_extra_information->'history' IS NOT NULL;
            "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        let db = _manager.get_connection();
        db.execute_unprepared(
            r#"
            UPDATE user_to_entity
            SET exercise_extra_information = jsonb_set(
                exercise_extra_information,
                '{history}',
                (
                    SELECT jsonb_agg(
                        history_elem - 'num_sets'
                    )
                    FROM jsonb_array_elements(exercise_extra_information->'history') AS history_elem
                ),
                true
            )
            WHERE exercise_extra_information IS NOT NULL
                AND exercise_extra_information->'history' IS NOT NULL;
            "#,
        )
        .await?;
        Ok(())
    }
}
