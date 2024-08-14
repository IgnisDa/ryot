use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum User {
    Table,
    Id,
    CreatedOn,
    Name,
    Password,
    Lot,
    Preferences,
    OidcIssuerId,
    ExtraInformation,
    IsDisabled,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(User::Table)
                    .col(ColumnDef::new(User::Id).text().not_null().primary_key())
                    .col(ColumnDef::new(User::Name).text().not_null())
                    .col(ColumnDef::new(User::Password).text())
                    .col(ColumnDef::new(User::Lot).text().not_null())
                    .col(ColumnDef::new(User::Preferences).json_binary().not_null())
                    .col(ColumnDef::new(User::OidcIssuerId).text())
                    .col(
                        ColumnDef::new(User::CreatedOn)
                            .timestamp()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(User::ExtraInformation).json_binary())
                    .col(ColumnDef::new(User::IsDisabled).boolean())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("user__name__index")
                    .table(User::Table)
                    .col(User::Name)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("user__oidc_issuer_id__index")
                    .table(User::Table)
                    .col(User::OidcIssuerId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
