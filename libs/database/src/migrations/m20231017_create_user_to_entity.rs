use sea_orm_migration::prelude::*;

use super::{
    m20230410_create_metadata::Metadata, m20230413_create_person::Person,
    m20230417_create_user::User, m20230622_create_exercise::Exercise,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static PERSON_FK_NAME: &str = "user_to_entity-fk4";
pub static PERSON_INDEX_NAME: &str = "user_to_entity-uqi3";
pub static CONSTRAINT_SQL: &str = r#"
ALTER TABLE "user_to_entity"
ADD CONSTRAINT "user_to_entity__ensure_one_entity"
CHECK (
    (CASE WHEN "metadata_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "person_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "exercise_id" IS NOT NULL THEN 1 ELSE 0 END)
    = 1
);
"#;

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
    CreatedOn,
    LastUpdatedOn,
    NeedsToBeUpdated,
    // the entities that can be associated
    MetadataId,
    ExerciseId,
    PersonId,
    // specifics
    MediaMonitored,
    MediaReminder,
    MetadataUnitsConsumed,
    MetadataOwnership,
    ExerciseExtraInformation,
    ExerciseNumTimesInteracted,
    MediaReason,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
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
                    .col(ColumnDef::new(UserToEntity::MediaMonitored).boolean())
                    .col(ColumnDef::new(UserToEntity::MediaReminder).json_binary())
                    .col(ColumnDef::new(UserToEntity::ExerciseNumTimesInteracted).integer())
                    .col(ColumnDef::new(UserToEntity::MetadataId).integer())
                    .col(ColumnDef::new(UserToEntity::ExerciseId).text())
                    .col(ColumnDef::new(UserToEntity::MetadataOwnership).json_binary())
                    .col(ColumnDef::new(UserToEntity::ExerciseExtraInformation).json_binary())
                    .col(ColumnDef::new(UserToEntity::MetadataUnitsConsumed).integer())
                    .col(ColumnDef::new(UserToEntity::MediaReason).array(ColumnType::Text))
                    .col(
                        ColumnDef::new(UserToEntity::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(UserToEntity::PersonId).integer())
                    .col(ColumnDef::new(UserToEntity::NeedsToBeUpdated).boolean())
                    .foreign_key(
                        ForeignKey::create()
                            .name("user_to_entity-fk1")
                            .from(UserToEntity::Table, UserToEntity::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("user_to_entity-fk2")
                            .from(UserToEntity::Table, UserToEntity::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("user_to_entity-fk3")
                            .from(UserToEntity::Table, UserToEntity::ExerciseId)
                            .to(Exercise::Table, Exercise::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name(PERSON_FK_NAME)
                            .from(UserToEntity::Table, UserToEntity::PersonId)
                            .to(Person::Table, Person::Id)
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
        db.execute_unprepared(CONSTRAINT_SQL).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
