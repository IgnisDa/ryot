use sea_orm_migration::prelude::*;

use super::m20230404_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum FilterPreset {
    Table,
    Id,
    UserId,
    Name,
    ContextType,
    ContextMetadata,
    Filters,
    CreatedAt,
    UpdatedAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(FilterPreset::Table)
                    .col(
                        ColumnDef::new(FilterPreset::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(FilterPreset::UserId).text().not_null())
                    .col(ColumnDef::new(FilterPreset::Name).text().not_null())
                    .col(ColumnDef::new(FilterPreset::ContextType).text().not_null())
                    .col(ColumnDef::new(FilterPreset::ContextMetadata).json_binary())
                    .col(
                        ColumnDef::new(FilterPreset::Filters)
                            .json_binary()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(FilterPreset::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(FilterPreset::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("filter_preset_to_user_foreign_key")
                            .from(FilterPreset::Table, FilterPreset::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("filter_preset_user_context_idx")
                    .table(FilterPreset::Table)
                    .col(FilterPreset::UserId)
                    .col(FilterPreset::ContextType)
                    .col(FilterPreset::ContextMetadata)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("filter_preset_user_context_name_uniq")
                    .table(FilterPreset::Table)
                    .col(FilterPreset::UserId)
                    .col(FilterPreset::ContextType)
                    .col(FilterPreset::ContextMetadata)
                    .col(FilterPreset::Name)
                    .unique()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
