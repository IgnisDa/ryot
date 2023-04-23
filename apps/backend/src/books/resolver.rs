use std::sync::Arc;

use async_graphql::{Context, InputObject, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use serde::{Deserialize, Serialize};

use crate::{
    entities::{
        book, creator, metadata, metadata_image, metadata_to_creator,
        prelude::{Book, Creator, MetadataImage},
    },
    graphql::IdObject,
    media::resolver::{MediaService, SearchResults},
    migrator::{MetadataImageLot, MetadataLot},
};

use super::{openlibrary::OpenlibraryService, BookSpecifics};

#[derive(Serialize, Deserialize, Debug, InputObject)]
pub struct BookSearchInput {
    query: String,
    offset: Option<i32>,
}

#[derive(Default)]
pub struct BooksQuery;

#[Object]
impl BooksQuery {
    /// Search for a list of books by a particular search query and an offset.
    async fn books_search(
        &self,
        gql_ctx: &Context<'_>,
        input: BookSearchInput,
    ) -> Result<SearchResults<BookSpecifics>> {
        gql_ctx
            .data_unchecked::<BooksService>()
            .books_search(&input.query, input.offset)
            .await
    }
}

#[derive(Default)]
pub struct BooksMutation;

#[Object]
impl BooksMutation {
    /// Fetch details about a book and create a media item in the database
    async fn commit_book(
        &self,
        gql_ctx: &Context<'_>,
        identifier: String,
        index: i32,
        input: BookSearchInput,
    ) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<BooksService>()
            .commit_book(&identifier, &input.query, input.offset, index)
            .await
    }
}

#[derive(Debug)]
pub struct BooksService {
    db: DatabaseConnection,
    openlibrary_service: Arc<OpenlibraryService>,
    media_service: Arc<MediaService>,
}

impl BooksService {
    pub fn new(
        db: &DatabaseConnection,
        openlibrary_service: &OpenlibraryService,
        media_service: &MediaService,
    ) -> Self {
        Self {
            openlibrary_service: Arc::new(openlibrary_service.clone()),
            media_service: Arc::new(media_service.clone()),
            db: db.clone(),
        }
    }
}

impl BooksService {
    // Get book details from all sources
    async fn books_search(
        &self,
        query: &str,
        offset: Option<i32>,
    ) -> Result<SearchResults<BookSpecifics>> {
        let books = self
            .openlibrary_service
            .search(query, offset)
            .await
            .unwrap();
        Ok(books)
    }

    async fn commit_book(
        &self,
        identifier: &str,
        query: &str,
        offset: Option<i32>,
        index: i32,
    ) -> Result<IdObject> {
        let id = if let Some(b) = Book::find()
            .filter(book::Column::OpenLibraryKey.eq(identifier))
            .one(&self.db)
            .await
            .unwrap()
        {
            b.metadata_id
        } else {
            let book_details = self
                .openlibrary_service
                .details(identifier, query, offset, index)
                .await
                .unwrap();
            let metadata = metadata::ActiveModel {
                lot: ActiveValue::Set(MetadataLot::Book),
                title: ActiveValue::Set(book_details.title),
                description: ActiveValue::Set(book_details.description),
                publish_year: ActiveValue::Set(book_details.publish_year),
                ..Default::default()
            };
            let metadata = metadata.insert(&self.db).await.unwrap();
            for image in book_details.images.into_iter() {
                if let Some(c) = MetadataImage::find()
                    .filter(metadata_image::Column::Url.eq(&image))
                    .one(&self.db)
                    .await
                    .unwrap()
                {
                    c
                } else {
                    let c = metadata_image::ActiveModel {
                        url: ActiveValue::Set(image),
                        lot: ActiveValue::Set(MetadataImageLot::Poster),
                        metadata_id: ActiveValue::Set(metadata.id),
                        ..Default::default()
                    };
                    c.insert(&self.db).await.unwrap()
                };
            }
            for name in book_details.author_names.into_iter() {
                let creator = if let Some(c) = Creator::find()
                    .filter(creator::Column::Name.eq(&name))
                    .one(&self.db)
                    .await
                    .unwrap()
                {
                    c
                } else {
                    let c = creator::ActiveModel {
                        name: ActiveValue::Set(name),
                        ..Default::default()
                    };
                    c.insert(&self.db).await.unwrap()
                };
                let metadata_creator = metadata_to_creator::ActiveModel {
                    metadata_id: ActiveValue::Set(metadata.id),
                    creator_id: ActiveValue::Set(creator.id),
                };
                metadata_creator.insert(&self.db).await.unwrap();
            }
            let book = book::ActiveModel {
                metadata_id: ActiveValue::Set(metadata.id),
                open_library_key: ActiveValue::Set(book_details.identifier),
                num_pages: ActiveValue::Set(book_details.specifics.pages),
            };
            let book = book.insert(&self.db).await.unwrap();
            book.metadata_id
        };
        Ok(IdObject { id })
    }
}
