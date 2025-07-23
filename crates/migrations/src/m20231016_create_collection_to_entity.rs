use indoc::indoc;
use sea_orm_migration::prelude::*;

use super::{
    m20230410_create_metadata::Metadata, m20230411_create_metadata_group::MetadataGroup,
    m20230413_create_person::Person, m20230504_create_collection::Collection,
    m20230505_create_exercise::Exercise, m20230506_create_workout_template::WorkoutTemplate,
    m20230507_create_workout::Workout,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static UNIQUE_INDEX_1: &str = "collection_to_entity_uqi1";
pub static UNIQUE_INDEX_2: &str = "collection_to_entity_uqi2";
pub static UNIQUE_INDEX_3: &str = "collection_to_entity_uqi3";
pub static UNIQUE_INDEX_4: &str = "collection_to_entity_uqi4";
pub static UNIQUE_INDEX_5: &str = "collection_to_entity_uqi5";
pub static UNIQUE_INDEX_6: &str = "collection_to_entity_uqi6";
pub static RANK_INDEX: &str = "collection_to_entity_rank_idx";
pub static CONSTRAINT_SQL: &str = indoc! { r#"
    ALTER TABLE "collection_to_entity" DROP CONSTRAINT IF EXISTS "collection_to_entity__ensure_one_entity";
    ALTER TABLE "collection_to_entity"
    ADD CONSTRAINT "collection_to_entity__ensure_one_entity"
    CHECK (
        (CASE WHEN "metadata_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "person_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "exercise_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "metadata_group_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "workout_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "workout_template_id" IS NOT NULL THEN 1 ELSE 0 END)
        = 1
    );
"# };
pub static ENTITY_ID_SQL: &str = indoc! { r#"
    GENERATED ALWAYS AS (
        COALESCE(
            "metadata_id",
            "person_id",
            "metadata_group_id",
            "exercise_id",
            "workout_id",
            "workout_template_id"
        )
    ) STORED
"# };
pub static ENTITY_LOT_SQL: &str = indoc! { r#"
    GENERATED ALWAYS AS (
        CASE
            WHEN "metadata_id" IS NOT NULL THEN 'metadata'
            WHEN "person_id" IS NOT NULL THEN 'person'
            WHEN "metadata_group_id" IS NOT NULL THEN 'metadata_group'
            WHEN "exercise_id" IS NOT NULL THEN 'exercise'
            WHEN "workout_id" IS NOT NULL THEN 'workout'
            WHEN "workout_template_id" IS NOT NULL THEN 'workout_template'
        END
    ) STORED
"# };

#[derive(Iden)]
pub enum CollectionToEntity {
    Table,
    Id,
    CollectionId,
    CreatedOn,
    LastUpdatedOn,
    Information,
    EntityId,
    EntityLot,
    Rank,
    // the entities that can be added to a collection
    MetadataId,
    MetadataGroupId,
    PersonId,
    ExerciseId,
    WorkoutId,
    WorkoutTemplateId,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        manager
            .create_table(
                Table::create()
                    .table(CollectionToEntity::Table)
                    .col(
                        ColumnDef::new(CollectionToEntity::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(CollectionToEntity::ExerciseId).text())
                    .col(ColumnDef::new(CollectionToEntity::Information).json_binary())
                    .col(
                        ColumnDef::new(CollectionToEntity::CollectionId)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(CollectionToEntity::MetadataGroupId).text())
                    .col(ColumnDef::new(CollectionToEntity::PersonId).text())
                    .col(ColumnDef::new(CollectionToEntity::MetadataId).text())
                    .col(
                        ColumnDef::new(CollectionToEntity::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(CollectionToEntity::Id)
                            .uuid()
                            .not_null()
                            .default(PgFunc::gen_random_uuid())
                            .primary_key(),
                    )
                    .col(ColumnDef::new(CollectionToEntity::WorkoutId).text())
                    .col(ColumnDef::new(CollectionToEntity::WorkoutTemplateId).text())
                    .col(
                        ColumnDef::new(CollectionToEntity::EntityId)
                            .text()
                            .not_null()
                            .extra(ENTITY_ID_SQL),
                    )
                    .col(
                        ColumnDef::new(CollectionToEntity::EntityLot)
                            .text()
                            .not_null()
                            .extra(ENTITY_LOT_SQL),
                    )
                    .col(
                        ColumnDef::new(CollectionToEntity::Rank)
                            .decimal()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_entity-fk1")
                            .from(CollectionToEntity::Table, CollectionToEntity::CollectionId)
                            .to(Collection::Table, Collection::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_entity-fk2")
                            .from(CollectionToEntity::Table, CollectionToEntity::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_entity-fk3")
                            .from(CollectionToEntity::Table, CollectionToEntity::PersonId)
                            .to(Person::Table, Person::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_entity-fk4")
                            .from(
                                CollectionToEntity::Table,
                                CollectionToEntity::MetadataGroupId,
                            )
                            .to(MetadataGroup::Table, MetadataGroup::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_entity-fk5")
                            .from(CollectionToEntity::Table, CollectionToEntity::ExerciseId)
                            .to(Exercise::Table, Exercise::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_entity-fk6")
                            .from(CollectionToEntity::Table, CollectionToEntity::WorkoutId)
                            .to(Workout::Table, Workout::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_entity-fk7")
                            .from(
                                CollectionToEntity::Table,
                                CollectionToEntity::WorkoutTemplateId,
                            )
                            .to(WorkoutTemplate::Table, WorkoutTemplate::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        for (name, column) in [
            (UNIQUE_INDEX_1, CollectionToEntity::MetadataId),
            (UNIQUE_INDEX_2, CollectionToEntity::PersonId),
            (UNIQUE_INDEX_3, CollectionToEntity::MetadataGroupId),
            (UNIQUE_INDEX_4, CollectionToEntity::ExerciseId),
            (UNIQUE_INDEX_5, CollectionToEntity::WorkoutId),
            (UNIQUE_INDEX_6, CollectionToEntity::WorkoutTemplateId),
        ] {
            manager
                .create_index(
                    Index::create()
                        .unique()
                        .name(name)
                        .table(CollectionToEntity::Table)
                        .col(CollectionToEntity::CollectionId)
                        .col(column)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .create_index(
                Index::create()
                    .name(RANK_INDEX)
                    .table(CollectionToEntity::Table)
                    .col(CollectionToEntity::Rank)
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
