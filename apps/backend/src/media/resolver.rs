use std::collections::HashMap;

use async_graphql::{Context, Error, Object, Result, SimpleObject};
use sea_orm::{DatabaseConnection, EntityTrait, ModelTrait};
use serde::{Deserialize, Serialize};

use crate::{
    entities::prelude::{Creator, Metadata, MetadataImage},
    migrator::MetadataLot,
};

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaItem {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    #[graphql(name = "type")]
    pub lot: MetadataLot,
    pub creators: Vec<String>,
    pub images: Vec<String>,
    pub publish_year: Option<i32>,
    pub extra: Option<HashMap<String, String>>,
}

#[derive(Default)]
pub struct MediaQuery;

#[Object]
impl MediaQuery {
    // Get details about a media item present in the database
    async fn media_details(&self, gql_ctx: &Context<'_>, metadata_id: i32) -> Result<MediaItem> {
        gql_ctx
            .data_unchecked::<MediaService>()
            .media_details(metadata_id)
            .await
    }
}

#[derive(Debug)]
pub struct MediaService {
    db: DatabaseConnection,
}

impl MediaService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
}

impl MediaService {
    async fn media_details(&self, metadata_id: i32) -> Result<MediaItem> {
        let meta = match Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
        {
            Some(m) => m,
            None => return Err(Error::new("The record does not exit".to_owned())),
        };
        let creators = meta.find_related(Creator).all(&self.db).await.unwrap();
        let images = meta
            .find_related(MetadataImage)
            .all(&self.db)
            .await
            .unwrap();
        let resp = MediaItem {
            id: meta.id,
            title: meta.title,
            description: meta.description,
            lot: meta.lot,
            creators: creators.into_iter().map(|c| c.name).collect(),
            images: images.into_iter().map(|i| i.url).collect(),
            publish_year: meta.publish_year,
            extra: Some(HashMap::new()),
        };
        Ok(resp)
    }
}
