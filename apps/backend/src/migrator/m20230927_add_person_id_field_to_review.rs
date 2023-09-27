use sea_orm_migration::prelude::*;

use super::{
    m20230413_create_person::Person, m20230505_create_review::PERSON_TO_REVIEW_FOREIGN_KEY, Review,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("review", "person_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Review::Table)
                        .add_column(ColumnDef::new(Review::PersonId).integer().null())
                        .add_foreign_key(
                            TableForeignKey::new()
                                .name(PERSON_TO_REVIEW_FOREIGN_KEY)
                                .from_tbl(Review::Table)
                                .from_col(Review::PersonId)
                                .to_tbl(Person::Table)
                                .to_col(Person::Id)
                                .on_delete(ForeignKeyAction::Cascade)
                                .on_update(ForeignKeyAction::Cascade),
                        )
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
