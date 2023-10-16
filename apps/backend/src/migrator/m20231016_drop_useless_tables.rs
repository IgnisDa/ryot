use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::m20230507_create_collection::MetadataToCollection;
use crate::entities::entity_to_collection;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "metadata_to_collection")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub metadata_id: i32,
    #[sea_orm(primary_key, auto_increment = false)]
    pub collection_id: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if manager.has_table("metadata_to_collection").await? {
            for mtc in Entity::find().all(db).await? {
                let to_insert = entity_to_collection::ActiveModel {
                    collection_id: ActiveValue::Set(mtc.collection_id),
                    metadata_id: ActiveValue::Set(Some(mtc.metadata_id)),
                    ..Default::default()
                };
                to_insert.insert(db).await?;
            }
            manager
                .drop_table(Table::drop().table(MetadataToCollection::Table).to_owned())
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
