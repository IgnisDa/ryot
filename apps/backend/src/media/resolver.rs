use async_graphql::{Context, Error, Object, Result, SimpleObject};
use sea_orm::{DatabaseConnection, EntityTrait, ModelTrait};
use serde::{Deserialize, Serialize};

use crate::{
    entities::prelude::{Book, Creator, Metadata, MetadataImage},
    migrator::MetadataLot,
};

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct BookDetails {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    #[graphql(name = "type")]
    pub lot: MetadataLot,
    pub creators: Vec<String>,
    pub images: Vec<String>,
    pub publish_year: Option<i32>,
    pub pages: Option<i32>,
}

#[derive(Default)]
pub struct MediaQuery;

#[Object]
impl MediaQuery {
    // Get details about a book present in the database
    async fn book_details(&self, gql_ctx: &Context<'_>, metadata_id: i32) -> Result<BookDetails> {
        gql_ctx
            .data_unchecked::<MediaService>()
            .book_details(metadata_id)
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
    async fn book_details(&self, metadata_id: i32) -> Result<BookDetails> {
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
        let book = Book::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let resp = BookDetails {
            id: meta.id,
            title: meta.title,
            description: meta.description,
            lot: meta.lot,
            creators: creators.into_iter().map(|c| c.name).collect(),
            images: images.into_iter().map(|i| i.url).collect(),
            publish_year: meta.publish_year,
            pages: book.num_pages,
        };
        Ok(resp)
    }
}
