use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r#"
UPDATE "workout" SET "id" = 'wor_' || "id";
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
DO $$
DECLARE
    rec RECORD;
    new_history jsonb;
    history_element jsonb;
BEGIN
    FOR rec IN
        SELECT id, exercise_extra_information
        FROM user_to_entity
        WHERE exercise_extra_information IS NOT NULL
    LOOP
        new_history := '[]'::jsonb;
        FOR history_element IN SELECT * FROM jsonb_array_elements(rec.exercise_extra_information->'history')
        LOOP
            new_history := jsonb_set(
                history_element,
                '{workout_id}',
                to_jsonb('wor_' || (history_element->>'workout_id'))
            );
        END LOOP;

        UPDATE user_to_entity
        SET exercise_extra_information = jsonb_set(
            rec.exercise_extra_information,
            '{history}',
            new_history
        )
        WHERE id = rec.id;
    END LOOP;
END $$;
"#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
