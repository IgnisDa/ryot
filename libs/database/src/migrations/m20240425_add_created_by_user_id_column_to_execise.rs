use sea_orm_migration::prelude::*;

use super::{m20230417_create_user::User, m20230622_create_exercise::Exercise};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("exercise", "created_by_user_id").await? {
            let db = manager.get_connection();
            db.execute_unprepared(r#"ALTER TABLE exercise ADD COLUMN created_by_user_id INTEGER;"#)
                .await?;
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(Exercise::Table)
                        .add_foreign_key(
                            TableForeignKey::new()
                                .name("workout_to_user_foreign_key")
                                .from_tbl(Exercise::Table)
                                .from_col(Exercise::CreatedByUserId)
                                .to_tbl(User::Table)
                                .to_col(User::Id)
                                .on_delete(ForeignKeyAction::SetNull)
                                .on_update(ForeignKeyAction::Cascade),
                        )
                        .to_owned(),
                )
                .await?;
            db.execute_unprepared(r#"UPDATE exercise SET created_by_user_id = (SELECT id FROM "user" WHERE lot = 'A' LIMIT 1) WHERE source = 'CU';"#)
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
