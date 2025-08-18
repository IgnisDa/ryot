use indoc::indoc;
use sea_orm_migration::prelude::*;

use super::{
    m20230410_create_metadata::Metadata, m20230411_create_metadata_group::MetadataGroup,
    m20230413_create_person::Person, m20230502_create_genre::Genre,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static CONSTRAINT_SQL: &str = indoc! { r#"
    ALTER TABLE "entity_to_entity" DROP CONSTRAINT IF EXISTS "entity_to_entity__ensure_one_source_entity";
    ALTER TABLE "entity_to_entity"
    ADD CONSTRAINT "entity_to_entity__ensure_one_source_entity"
    CHECK (
        (CASE WHEN "from_metadata_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "from_metadata_group_id" IS NOT NULL THEN 1 ELSE 0 END)
        = 1
    );

    ALTER TABLE "entity_to_entity" DROP CONSTRAINT IF EXISTS "entity_to_entity__ensure_one_target_entity";
    ALTER TABLE "entity_to_entity"
    ADD CONSTRAINT "entity_to_entity__ensure_one_target_entity"
    CHECK (
        (CASE WHEN "to_metadata_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "to_person_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "to_genre_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "to_metadata_group_id" IS NOT NULL THEN 1 ELSE 0 END)
        = 1
    );
"# };

#[derive(Iden)]
pub enum EntityToEntity {
    Table,
    Id,
    FromMetadataId,
    FromMetadataGroupId,
    ToMetadataId,
    ToPersonId,
    ToGenreId,
    ToMetadataGroupId,
    Relation,
    Role,
    CharacterName,
    IndexPosition,
    Part,
    CreatedAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        manager
            .create_table(
                Table::create()
                    .table(EntityToEntity::Table)
                    .col(
                        ColumnDef::new(EntityToEntity::Id)
                            .uuid()
                            .not_null()
                            .default(PgFunc::gen_random_uuid())
                            .primary_key(),
                    )
                    .col(ColumnDef::new(EntityToEntity::FromMetadataId).text())
                    .col(ColumnDef::new(EntityToEntity::FromMetadataGroupId).text())
                    .col(ColumnDef::new(EntityToEntity::ToMetadataId).text())
                    .col(ColumnDef::new(EntityToEntity::ToPersonId).text())
                    .col(ColumnDef::new(EntityToEntity::ToGenreId).text())
                    .col(ColumnDef::new(EntityToEntity::ToMetadataGroupId).text())
                    .col(ColumnDef::new(EntityToEntity::Relation).text().not_null())
                    .col(ColumnDef::new(EntityToEntity::Role).text())
                    .col(ColumnDef::new(EntityToEntity::CharacterName).text())
                    .col(ColumnDef::new(EntityToEntity::IndexPosition).integer())
                    .col(ColumnDef::new(EntityToEntity::Part).integer())
                    .col(
                        ColumnDef::new(EntityToEntity::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_to_entity-fk-from_metadata")
                            .from(EntityToEntity::Table, EntityToEntity::FromMetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_to_entity-fk-from_metadata_group")
                            .from(EntityToEntity::Table, EntityToEntity::FromMetadataGroupId)
                            .to(MetadataGroup::Table, MetadataGroup::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_to_entity-fk-to_metadata")
                            .from(EntityToEntity::Table, EntityToEntity::ToMetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_to_entity-fk-to_person")
                            .from(EntityToEntity::Table, EntityToEntity::ToPersonId)
                            .to(Person::Table, Person::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_to_entity-fk-to_genre")
                            .from(EntityToEntity::Table, EntityToEntity::ToGenreId)
                            .to(Genre::Table, Genre::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_to_entity-fk-to_metadata_group")
                            .from(EntityToEntity::Table, EntityToEntity::ToMetadataGroupId)
                            .to(MetadataGroup::Table, MetadataGroup::Id)
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
                    .name("entity_to_entity-uqi-metadata_person")
                    .table(EntityToEntity::Table)
                    .col(EntityToEntity::FromMetadataId)
                    .col(EntityToEntity::ToPersonId)
                    .col(EntityToEntity::Relation)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("entity_to_entity-uqi-metadata_genre")
                    .table(EntityToEntity::Table)
                    .col(EntityToEntity::FromMetadataId)
                    .col(EntityToEntity::ToGenreId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("entity_to_entity-uqi-metadata_metadata")
                    .table(EntityToEntity::Table)
                    .col(EntityToEntity::FromMetadataId)
                    .col(EntityToEntity::ToMetadataId)
                    .col(EntityToEntity::Relation)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("entity_to_entity-uqi-metadata_metadata_group")
                    .table(EntityToEntity::Table)
                    .col(EntityToEntity::FromMetadataId)
                    .col(EntityToEntity::ToMetadataGroupId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("entity_to_entity-uqi-metadata_group_person")
                    .table(EntityToEntity::Table)
                    .col(EntityToEntity::FromMetadataGroupId)
                    .col(EntityToEntity::ToPersonId)
                    .col(EntityToEntity::Relation)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("entity_to_entity-idx-from_metadata")
                    .table(EntityToEntity::Table)
                    .col(EntityToEntity::FromMetadataId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("entity_to_entity-idx-from_metadata_group")
                    .table(EntityToEntity::Table)
                    .col(EntityToEntity::FromMetadataGroupId)
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
