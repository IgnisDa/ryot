use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230622_000013_create_exercise"
    }
}

#[derive(Iden)]
pub enum Exercise {
    Table,
    Id,
    Name,
    Identifier,
    Attributes,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Exercise::Table)
                    .col(
                        ColumnDef::new(Exercise::Id)
                            .primary_key()
                            .auto_increment()
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Exercise::Name)
                            .string()
                            .unique_key()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Exercise::Identifier)
                            .string()
                            .unique_key()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Exercise::Attributes).json().not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("exercise__name__index")
                    .table(Exercise::Table)
                    .col(Exercise::Name)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("exercise__identifier__index")
                    .table(Exercise::Table)
                    .col(Exercise::Identifier)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
