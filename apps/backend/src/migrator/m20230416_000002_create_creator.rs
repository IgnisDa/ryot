use sea_orm_migration::prelude::*;

use super::MediaItemMetadata;

pub struct Migration;

#[derive(Iden)]
pub enum Creator {
    Table,
    Id,
    Name,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230416_000002_create_creator"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Creator::Table)
                    .col(
                        ColumnDef::new(Creator::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Creator::Name).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("creator_to_book_foreign_key")
                            .from(Creator::Table, Creator::Id)
                            .to(MediaItemMetadata::Table, MediaItemMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Creator::Table).to_owned())
            .await?;
        Ok(())
    }
}
