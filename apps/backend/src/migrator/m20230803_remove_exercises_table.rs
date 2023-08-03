use sea_orm::{ActiveValue, EntityTrait};
use sea_orm_migration::prelude::*;

use crate::{
    entities::{creator, prelude::Creator as CreatorModel},
    models::media::CreatorExtraInformation,
};

use super::{m20230622_000013_create_exercise::Exercise, m20230730_create_creator::Creator};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230803_remove_exercises_table"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("creator", "extra_information").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Creator::Table)
                        .add_column_if_not_exists(ColumnDef::new(Creator::ExtraInformation).json())
                        .to_owned(),
                )
                .await?;
            let db = manager.get_connection();
            let mut creator = creator::ActiveModel {
                ..Default::default()
            };
            creator.extra_information = ActiveValue::Set(CreatorExtraInformation { active: true });
            CreatorModel::update_many().set(creator).exec(db).await?;
            manager
                .alter_table(
                    Table::alter()
                        .table(Creator::Table)
                        .modify_column(ColumnDef::new(Creator::ExtraInformation).json().not_null())
                        .to_owned(),
                )
                .await?;
        }
        if manager.has_table("exercise").await? {
            manager
                .drop_table(Table::drop().table(Exercise::Table).to_owned())
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
