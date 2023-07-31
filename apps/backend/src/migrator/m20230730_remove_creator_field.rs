use sea_orm::{entity::prelude::*, ActiveValue, FromJsonQueryResult};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use crate::entities::{
    creator, metadata_to_creator,
    prelude::{Creator, MetadataToCreator},
};

use super::Metadata;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230730_remove_creator_field"
    }
}

#[derive(
    Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default, Hash,
)]
pub struct MetadataCreator {
    pub name: String,
    pub role: String,
    pub image_urls: Vec<String>,
}

#[derive(
    Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default, Hash,
)]
pub struct MetadataCreators(pub Vec<MetadataCreator>);

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize, Default)]
#[sea_orm(table_name = "metadata")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub creators: MetadataCreators,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let alias = Alias::new("creators");
        if manager.has_column("metadata", "creators").await? {
            let db = manager.get_connection();
            for metadata in Entity::find().all(db).await? {
                for cr in metadata.creators.0 {
                    let existing_creator = Creator::find()
                        .filter(creator::Column::Name.eq(cr.name.clone()))
                        .one(db)
                        .await?;
                    let cr_id = if let Some(ex) = existing_creator {
                        ex.id
                    } else {
                        let new_cr = creator::ActiveModel {
                            name: ActiveValue::Set(cr.name),
                            image: ActiveValue::Set(cr.image_urls.first().cloned()),
                            ..Default::default()
                        };
                        let ca = new_cr.insert(db).await?;
                        ca.id
                    };
                    let existing_association = MetadataToCreator::find()
                        .filter(metadata_to_creator::Column::MetadataId.eq(metadata.id))
                        .filter(metadata_to_creator::Column::CreatorId.eq(cr_id))
                        .one(db)
                        .await?;
                    if existing_association.is_none() {
                        let association = metadata_to_creator::ActiveModel {
                            metadata_id: ActiveValue::Set(metadata.id),
                            creator_id: ActiveValue::Set(cr_id),
                            role: ActiveValue::Set(cr.role),
                            index: ActiveValue::Set(0),
                        };
                        association.insert(db).await?;
                    }
                }
            }
            manager
                .alter_table(
                    Table::alter()
                        .table(Metadata::Table)
                        .drop_column(alias.clone())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
