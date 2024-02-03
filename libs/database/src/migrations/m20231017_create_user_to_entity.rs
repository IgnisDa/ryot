use sea_orm_migration::prelude::*;

use super::{
    m20230410_create_metadata::Metadata, m20230417_create_user::User,
    m20230622_create_exercise::Exercise,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

/// A media is related to a user if at least one of the following hold:
/// - the user has it in their seen history
/// - added it to a collection
/// - has reviewed it
/// - added to their monitored media
/// - added a reminder
#[derive(Iden)]
pub enum UserToEntity {
    Table,
    Id,
    UserId,
    LastUpdatedOn,
    // the entities that can be associated
    MetadataId,
    ExerciseId,
    // specifics
    MetadataMonitored,
    MetadataReminder,
    MetadataUnitsConsumed,
    MetadataOwnership,
    MetadataReason,
    ExerciseExtraInformation,
    ExerciseNumTimesInteracted,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(UserToEntity::Table)
                    .col(
                        ColumnDef::new(UserToEntity::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(UserToEntity::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(UserToEntity::UserId).integer().not_null())
                    .col(ColumnDef::new(UserToEntity::MetadataMonitored).boolean())
                    .col(ColumnDef::new(UserToEntity::MetadataReminder).json_binary())
                    .col(ColumnDef::new(UserToEntity::MetadataUnitsConsumed).integer())
                    .col(ColumnDef::new(UserToEntity::MetadataOwnership).json_binary())
                    .col(ColumnDef::new(UserToEntity::MetadataReason).array(ColumnType::Text))
                    .col(ColumnDef::new(UserToEntity::ExerciseNumTimesInteracted).integer())
                    .col(ColumnDef::new(UserToEntity::ExerciseExtraInformation).json_binary())
                    .foreign_key(
                        ForeignKey::create()
                            .name("user_to_entity-fk1")
                            .from(UserToEntity::Table, UserToEntity::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(UserToEntity::MetadataId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("user_to_entity-fk2")
                            .from(UserToEntity::Table, UserToEntity::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(UserToEntity::ExerciseId).string())
                    .foreign_key(
                        ForeignKey::create()
                            .name("user_to_entity-fk3")
                            .from(UserToEntity::Table, UserToEntity::ExerciseId)
                            .to(Exercise::Table, Exercise::Id)
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
                    .name("user_to_entity-uqi1")
                    .table(UserToEntity::Table)
                    .col(UserToEntity::UserId)
                    .col(UserToEntity::MetadataId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("user_to_entity-uqi2")
                    .table(UserToEntity::Table)
                    .col(UserToEntity::UserId)
                    .col(UserToEntity::ExerciseId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
