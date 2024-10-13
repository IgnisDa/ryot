use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        for x in ["workout", "workout_template"] {
            db.execute_unprepared(&format!(
                r#"
UPDATE "{x}"
SET "information" = jsonb_set(
    "information",
    '{{exercises}}',
    (
    SELECT jsonb_agg(
        jsonb_set(
            exercise,
            '{{identifier}}',
            to_jsonb(gen_random_uuid())
            )
        )
        FROM jsonb_array_elements("information"->'exercises') AS exercise
    )
);

UPDATE "{x}"
SET "summary" = jsonb_set(
    "summary",
    '{{exercises}}',
    (
        SELECT jsonb_agg(
            jsonb_set(
                exercise - 'id',
                '{{name}}',
                exercise->'id'
            )
        )
        FROM jsonb_array_elements("summary"->'exercises') AS exercise
    )
);
                    "#,
            ))
            .await?;
        }
        db.execute_unprepared(
            r#"
UPDATE "user_to_entity"
SET "exercise_extra_information" = jsonb_set(
    "exercise_extra_information",
    '{settings}',
    jsonb_build_object('rest_timer', '{}'::jsonb)
)
WHERE "user_to_entity"."exercise_extra_information" IS NOT NULL;
        "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
