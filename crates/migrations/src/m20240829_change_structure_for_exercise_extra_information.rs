use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
DO $$
DECLARE
    rec RECORD;
    new_history JSONB;
    best_set JSONB;
    history_element JSONB;
BEGIN
    -- Loop through each row in the user_to_entity table where exercise_extra_information is not null
    FOR rec IN
        SELECT id, exercise_extra_information
        FROM "user_to_entity"
        WHERE exercise_extra_information IS NOT NULL
    LOOP
        -- Initialize an empty array to store the new history with best_set
        new_history := '[]'::jsonb;

        -- Loop through each history element in exercise_extra_information
        FOR history_element IN
            SELECT * FROM jsonb_array_elements(rec.exercise_extra_information->'history')
        LOOP
            -- Build the new history element with the value
            new_history := new_history || jsonb_set(
                history_element,
                '{workout_end_on}',
                '"2024-08-26 00:43:30 +00:00"'
            );
        END LOOP;

        -- Update the exercise_extra_information field with the new history format
        UPDATE "user_to_entity"
        SET exercise_extra_information = jsonb_set(
            exercise_extra_information,
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
