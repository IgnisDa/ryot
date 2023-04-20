use async_graphql::{Context, Error, Object, OutputType, Result, SimpleObject};
use sea_orm::{DatabaseConnection, EntityTrait, ModelTrait};
use serde::{Deserialize, Serialize};

use crate::{
    entities::{
        metadata::Model as MetadataModel,
        prelude::{Book, Creator, Metadata, MetadataImage},
    },
    migrator::MetadataLot,
};

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct BookSpecifics {
    pub pages: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
#[graphql(concrete(name = "BookDetails", params(BookSpecifics)))]
pub struct MediaDetails<T: OutputType> {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    #[graphql(name = "type")]
    pub lot: MetadataLot,
    pub creators: Vec<String>,
    pub images: Vec<String>,
    pub publish_year: Option<i32>,
    pub specifics: T,
}

#[derive(Default)]
pub struct MediaQuery;

#[Object]
impl MediaQuery {
    // Get details about a book present in the database
    async fn book_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: i32,
    ) -> Result<MediaDetails<BookSpecifics>> {
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
    async fn generic_metadata(
        &self,
        metadata_id: i32,
    ) -> Result<(MetadataModel, Vec<String>, Vec<String>)> {
        let meta = match Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
        {
            Some(m) => m,
            None => return Err(Error::new("The record does not exit".to_owned())),
        };
        let creators = meta
            .find_related(Creator)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        let images = meta
            .find_related(MetadataImage)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|i| i.url)
            .collect();
        Ok((meta, creators, images))
    }

    async fn book_details(&self, metadata_id: i32) -> Result<MediaDetails<BookSpecifics>> {
        let (meta, creators, images) = self.generic_metadata(metadata_id).await?;
        let book = Book::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let resp = MediaDetails {
            id: meta.id,
            title: meta.title,
            description: meta.description,
            publish_year: meta.publish_year,
            lot: meta.lot,
            creators,
            images,
            specifics: BookSpecifics {
                pages: book.num_pages,
            },
        };
        Ok(resp)
    }
}
