use sea_orm_migration::prelude::*;

use super::m20230502_000008_create_video_game::VideoGame;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230605_000020_add_platform_field"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(VideoGame::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(VideoGame::Details)
                            .json()
                            .default(r#"{"source": "Igdb", "platforms": []}"#),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
