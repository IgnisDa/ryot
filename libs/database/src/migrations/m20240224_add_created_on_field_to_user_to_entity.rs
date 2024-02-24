use sea_orm_migration::prelude::*;

use super::m20231017_create_user_to_entity::UserToEntity;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("user_to_entity", "created_on").await? {
            let db = manager.get_connection();
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(UserToEntity::Table)
                        .add_column(
                            ColumnDef::new(UserToEntity::CreatedOn)
                                .timestamp_with_time_zone()
                                .not_null()
                                .default(Expr::current_timestamp()),
                        )
                        .to_owned(),
                )
                .await?;
            // for media
            db.execute_unprepared(
                "
UPDATE user_to_entity
SET created_on = seen.updated_at[1]
FROM seen
WHERE user_to_entity.metadata_id = seen.metadata_id
AND user_to_entity.metadata_id IS NOT NULL;
",
            )
            .await?;
            // for exercises
            db.execute_unprepared(
                "
UPDATE user_to_entity
SET created_on = workout.end_time
FROM workout
WHERE workout.id = (user_to_entity.exercise_extra_information -> 'history' -> -1 ->> 'workout_id')::text
AND user_to_entity.exercise_id IS NOT NULL;
",
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
