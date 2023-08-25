use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // FIXME: https://github.com/SeaQL/sea-orm/issues/1827
        // manager
        //     .drop_index(Index::drop().name(IDENTIFIER_INDEX).to_owned())
        //     .await
        //     .ok();
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
