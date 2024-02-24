use sea_orm_migration::prelude::*;

use super::{
    m20230413_create_person::Person,
    m20231017_create_user_to_entity::{UserToEntity, PERSON_FK_NAME, PERSON_INDEX_NAME},
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("user_to_entity", "person_id").await? {
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(UserToEntity::Table)
                        .add_column(ColumnDef::new(UserToEntity::PersonId).integer())
                        .to_owned(),
                )
                .await?;
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(UserToEntity::Table)
                        .add_foreign_key(
                            TableForeignKey::new()
                                .name(PERSON_FK_NAME)
                                .from_tbl(UserToEntity::Table)
                                .from_col(UserToEntity::PersonId)
                                .to_tbl(Person::Table)
                                .to_col(Person::Id)
                                .on_delete(ForeignKeyAction::Cascade)
                                .on_update(ForeignKeyAction::Cascade),
                        )
                        .to_owned(),
                )
                .await?;
            manager
                .create_index(
                    Index::create()
                        .unique()
                        .name(PERSON_INDEX_NAME)
                        .table(UserToEntity::Table)
                        .col(UserToEntity::UserId)
                        .col(UserToEntity::PersonId)
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
