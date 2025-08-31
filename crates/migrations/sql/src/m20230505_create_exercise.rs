use migrations_utils::create_trigram_index_if_required;
use sea_orm_migration::prelude::*;

use super::m20230404_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static EXERCISE_NAME_TRIGRAM_INDEX: &str = "exercise_name_trigram_idx";
pub static EXERCISE_AGGREGATED_INSTRUCTIONS_TRIGRAM_INDEX: &str =
    "exercise_aggregated_instructions_trigram_idx";

#[derive(Iden)]
pub enum Exercise {
    Table,
    Id,
    Lot,
    Name,
    Force,
    Level,
    Source,
    Assets,
    Muscles,
    Mechanic,
    Equipment,
    Instructions,
    CreatedByUserId,
    AggregatedInstructions,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Exercise::Table)
                    .col(ColumnDef::new(Exercise::Id).primary_key().text().not_null())
                    .col(ColumnDef::new(Exercise::Name).text())
                    .col(ColumnDef::new(Exercise::Lot).text().not_null())
                    .col(ColumnDef::new(Exercise::Level).text().not_null())
                    .col(ColumnDef::new(Exercise::Force).text())
                    .col(ColumnDef::new(Exercise::Mechanic).text())
                    .col(ColumnDef::new(Exercise::Equipment).text())
                    .col(ColumnDef::new(Exercise::Source).text().not_null())
                    .col(ColumnDef::new(Exercise::CreatedByUserId).text())
                    .col(
                        ColumnDef::new(Exercise::Muscles)
                            .array(ColumnType::Text)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Exercise::Instructions)
                            .array(ColumnType::Text)
                            .not_null()
                            .default("{}"),
                    )
                    .col(ColumnDef::new(Exercise::Assets).json_binary().not_null())
                    .col(
                        ColumnDef::new(Exercise::AggregatedInstructions)
                            .text()
                            .not_null()
                            .extra("GENERATED ALWAYS AS (array_to_string_immutable(instructions, E'\\n')) STORED")
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("exercise_to_user_foreign_key")
                            .from(Exercise::Table, Exercise::CreatedByUserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        create_trigram_index_if_required(manager, "exercise", "name", EXERCISE_NAME_TRIGRAM_INDEX).await?;
        create_trigram_index_if_required(
            manager,
            "exercise",
            "aggregated_instructions",
            EXERCISE_AGGREGATED_INSTRUCTIONS_TRIGRAM_INDEX,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
