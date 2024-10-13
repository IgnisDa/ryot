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
                            '{{id}}',
                            to_jsonb(gen_random_uuid())
                            )
                        )
                        FROM jsonb_array_elements("information"->'exercises') AS exercise
                        )
                    );
                    "#,
            ))
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
