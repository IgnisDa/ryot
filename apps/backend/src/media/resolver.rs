use async_graphql::{Context, Error, Object, OutputType, Result, SimpleObject};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait, QueryFilter};
use serde::{Deserialize, Serialize};

use crate::{
    entities::{
        book,
        metadata::Model as MetadataModel,
        prelude::{Book, Creator, Metadata, MetadataImage, Seen},
        seen,
    },
    migrator::MetadataLot,
    utils::user_id_from_ctx,
};

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaSeen {
    pub identifier: String,
    pub seen: bool,
}

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

    // Whether a book has been read by a user
    async fn book_read(
        &self,
        gql_ctx: &Context<'_>,
        identifiers: Vec<String>,
    ) -> Result<Vec<MediaSeen>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .book_read(identifiers, user_id)
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

    async fn book_read(&self, identifiers: Vec<String>, user_id: i32) -> Result<Vec<MediaSeen>> {
        let books = Book::find()
            .filter(book::Column::OpenLibraryKey.is_in(&identifiers))
            .all(&self.db)
            .await
            .unwrap();
        let seen = Seen::find()
            .filter(seen::Column::UserId.eq(user_id))
            .filter(
                seen::Column::MetadataId
                    .is_in(books.iter().map(|b| b.metadata_id).collect::<Vec<_>>()),
            )
            .all(&self.db)
            .await
            .unwrap();
        let mut resp = vec![];
        for identifier in identifiers {
            let is_in_database = books.iter().find(|b| b.open_library_key == identifier);
            if let Some(m) = is_in_database {
                let is_there = seen.iter().any(|b| b.metadata_id == m.metadata_id);
                resp.push(MediaSeen {
                    identifier,
                    seen: is_there,
                });
            } else {
                resp.push(MediaSeen {
                    identifier,
                    seen: false,
                });
            }
        }
        Ok(resp)
    }
}
