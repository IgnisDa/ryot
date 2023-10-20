use sea_orm::{entity::prelude::*, ActiveValue, QuerySelect};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use crate::{
    entities::{
        collection, collection_to_entity, exercise,
        prelude::{Collection, CollectionToEntity, Exercise},
    },
    miscellaneous::DefaultCollection,
};

use super::ExerciseSource;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum MetadataToCollection {
    Table,
}

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
            let mut all_to_insert = vec![];
            for mtc in Entity::find().all(db).await? {
                let to_insert = collection_to_entity::ActiveModel {
                    collection_id: ActiveValue::Set(mtc.collection_id),
                    metadata_id: ActiveValue::Set(Some(mtc.metadata_id)),
                    ..Default::default()
                };
                all_to_insert.push(to_insert);
            }
            CollectionToEntity::insert_many(all_to_insert)
                .exec(db)
                .await?;
            manager
                .drop_table(Table::drop().table(MetadataToCollection::Table).to_owned())
                .await?;
        }
        let collections = Collection::find()
            .select_only()
            .column(collection::Column::Id)
            .filter(collection::Column::Name.eq(DefaultCollection::Custom.to_string()))
            .into_tuple::<i32>()
            .all(db)
            .await?;
        for ex in Exercise::find()
            .filter(exercise::Column::Source.eq(ExerciseSource::Custom))
            .all(db)
            .await?
        {
            for col_id in collections.iter() {
                let to_insert = collection_to_entity::ActiveModel {
                    collection_id: ActiveValue::Set(col_id.to_owned()),
                    exercise_id: ActiveValue::Set(Some(ex.id)),
                    ..Default::default()
                };
                to_insert.insert(db).await?;
            }
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
