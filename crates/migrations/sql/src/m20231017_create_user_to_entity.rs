use indoc::indoc;
use sea_orm_migration::prelude::*;

use super::{
    m20230404_create_user::User, m20230410_create_metadata::Metadata,
    m20230411_create_metadata_group::MetadataGroup, m20230413_create_person::Person,
    m20230504_create_collection::Collection, m20230505_create_exercise::Exercise,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static USER_TO_ENTITY_PERSON_FK_NAME: &str = "user_to_entity-fk4";
pub static USER_TO_ENTITY_PERSON_INDEX_NAME: &str = "user_to_entity-uqi3";
pub static USER_TO_ENTITY_COLLECTION_FK_NAME: &str = "user_to_entity-fk6";
pub static USER_TO_ENTITY_COLLECTION_INDEX_NAME: &str = "user_to_entity-uqi5";
pub static USER_TO_ENTITY_METADATA_GROUP_FK_NAME: &str = "user_to_entity-fk5";
pub static USER_TO_ENTITY_METADATA_GROUP_INDEX_NAME: &str = "user_to_entity-uqi4";
pub static USER_TO_ENTITY_CONSTRAINT_SQL: &str = indoc! { r#"
    ALTER TABLE "user_to_entity" DROP CONSTRAINT IF EXISTS "user_to_entity__ensure_one_entity";
    ALTER TABLE "user_to_entity"
    ADD CONSTRAINT "user_to_entity__ensure_one_entity"
    CHECK (
        (CASE WHEN "metadata_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "person_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "exercise_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "metadata_group_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "collection_id" IS NOT NULL THEN 1 ELSE 0 END)
        = 1
    );
"# };
pub static ENTITY_ID_SQL: &str = indoc! { r#"
    GENERATED ALWAYS AS (
        COALESCE(
            "exercise_id",
            "metadata_id",
            "person_id",
            "metadata_group_id",
            "collection_id"
        )
    ) STORED
"# };
pub static ENTITY_LOT_SQL: &str = indoc! { r#"
    GENERATED ALWAYS AS (
        CASE
            WHEN "exercise_id" IS NOT NULL THEN 'exercise'
            WHEN "metadata_id" IS NOT NULL THEN 'metadata'
            WHEN "person_id" IS NOT NULL THEN 'person'
            WHEN "metadata_group_id" IS NOT NULL THEN 'metadata_group'
            WHEN "collection_id" IS NOT NULL THEN 'collection'
        END
    ) STORED
"# };

/// A media is related to a user if at least one of the following hold:
/// - the user has it in their seen history
/// - added it to a collection
/// - has reviewed it
#[derive(Iden)]
pub enum UserToEntity {
    Id,
    Table,
    UserId,
    PersonId,
    EntityId,
    CreatedOn,
    EntityLot,
    MetadataId,
    ExerciseId,
    MediaReason,
    CollectionId,
    LastUpdatedOn,
    MetadataGroupId,
    NeedsToBeUpdated,
    ExerciseExtraInformation,
    CollectionExtraInformation,
    ExerciseNumTimesInteracted,
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
                        ColumnDef::new(UserToEntity::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(UserToEntity::ExerciseNumTimesInteracted).integer())
                    .col(ColumnDef::new(UserToEntity::ExerciseId).text())
                    .col(ColumnDef::new(UserToEntity::ExerciseExtraInformation).json_binary())
                    .col(ColumnDef::new(UserToEntity::MediaReason).array(ColumnType::Text))
                    .col(
                        ColumnDef::new(UserToEntity::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(UserToEntity::NeedsToBeUpdated).boolean())
                    .col(ColumnDef::new(UserToEntity::MetadataGroupId).text())
                    .col(ColumnDef::new(UserToEntity::PersonId).text())
                    .col(ColumnDef::new(UserToEntity::MetadataId).text())
                    .col(ColumnDef::new(UserToEntity::UserId).text().not_null())
                    .col(
                        ColumnDef::new(UserToEntity::Id)
                            .uuid()
                            .not_null()
                            .default(PgFunc::gen_random_uuid())
                            .primary_key(),
                    )
                    .col(ColumnDef::new(UserToEntity::CollectionId).text())
                    .col(ColumnDef::new(UserToEntity::CollectionExtraInformation).json_binary())
                    .col(
                        ColumnDef::new(UserToEntity::EntityLot)
                            .text()
                            .not_null()
                            .extra(ENTITY_LOT_SQL),
                    )
                    .col(
                        ColumnDef::new(UserToEntity::EntityId)
                            .text()
                            .not_null()
                            .extra(ENTITY_ID_SQL),
                    )
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
                            .name(USER_TO_ENTITY_PERSON_FK_NAME)
                            .from(UserToEntity::Table, UserToEntity::PersonId)
                            .to(Person::Table, Person::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name(USER_TO_ENTITY_METADATA_GROUP_FK_NAME)
                            .from(UserToEntity::Table, UserToEntity::MetadataGroupId)
                            .to(MetadataGroup::Table, MetadataGroup::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name(USER_TO_ENTITY_COLLECTION_FK_NAME)
                            .from(UserToEntity::Table, UserToEntity::CollectionId)
                            .to(Collection::Table, MetadataGroup::Id)
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
                    .name(USER_TO_ENTITY_PERSON_INDEX_NAME)
                    .table(UserToEntity::Table)
                    .col(UserToEntity::UserId)
                    .col(UserToEntity::PersonId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name(USER_TO_ENTITY_METADATA_GROUP_INDEX_NAME)
                    .table(UserToEntity::Table)
                    .col(UserToEntity::UserId)
                    .col(UserToEntity::MetadataGroupId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name(USER_TO_ENTITY_COLLECTION_INDEX_NAME)
                    .table(UserToEntity::Table)
                    .col(UserToEntity::UserId)
                    .col(UserToEntity::CollectionId)
                    .to_owned(),
            )
            .await?;
        db.execute_unprepared(USER_TO_ENTITY_CONSTRAINT_SQL).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
