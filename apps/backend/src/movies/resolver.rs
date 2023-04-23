use std::sync::Arc;

use async_graphql::{Context, InputObject, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use serde::{Deserialize, Serialize};

use crate::{
    entities::{
        book, creator, metadata, metadata_image, metadata_to_creator,
        prelude::{Creator, MetadataImage},
    },
    graphql::IdObject,
    media::resolver::{MediaService, SearchResults},
    migrator::{MetadataImageLot, MetadataLot},
    utils::user_id_from_ctx,
};

use super::{tmdb::TmdbService, MovieSpecifics};

#[derive(Serialize, Deserialize, Debug, InputObject)]
pub struct MoviesSearchInput {
    query: String,
    page: Option<i32>,
}

#[derive(Default)]
pub struct MoviesQuery;

#[Object]
impl MoviesQuery {
    /// Search for a list of movies by a particular search query and an offset.
    async fn movies_search(
        &self,
        gql_ctx: &Context<'_>,
        input: MoviesSearchInput,
    ) -> Result<SearchResults<MovieSpecifics>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MoviesService>()
            .movies_search(&input.query, input.page, user_id)
            .await
    }
}

#[derive(Default)]
pub struct MoviesMutation;

#[Object]
impl MoviesMutation {
    /// Fetch details about a book and create a media item in the database
    async fn commit_book(
        &self,
        gql_ctx: &Context<'_>,
        identifier: String,
        index: i32,
        input: MoviesSearchInput,
    ) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<MoviesService>()
            .commit_movie(&identifier, &input.query, input.page, index)
            .await
    }
}

#[derive(Debug)]
pub struct MoviesService {
    db: DatabaseConnection,
    tmpdb_service: Arc<TmdbService>,
    media_service: Arc<MediaService>,
}

impl MoviesService {
    pub fn new(
        db: &DatabaseConnection,
        tmdb_service: &TmdbService,
        media_service: &MediaService,
    ) -> Self {
        Self {
            tmpdb_service: Arc::new(tmdb_service.clone()),
            media_service: Arc::new(media_service.clone()),
            db: db.clone(),
        }
    }
}

impl MoviesService {
    // Get movie details from all sources
    async fn movies_search(
        &self,
        query: &str,
        page: Option<i32>,
        user_id: i32,
    ) -> Result<SearchResults<MovieSpecifics>> {
        let mut movies = self.tmpdb_service.search(query, page).await.unwrap();
        let is_read = self
            .media_service
            .book_read(
                movies.items.iter().map(|b| b.identifier.clone()).collect(),
                user_id,
            )
            .await?;
        for rsp in movies.items.iter_mut() {
            let seen_status = is_read
                .iter()
                .find(|ir| ir.identifier == rsp.identifier)
                .unwrap();
            rsp.status = seen_status.seen;
        }
        Ok(movies)
    }

    async fn commit_movie(
        &self,
        identifier: &str,
        query: &str,
        offset: Option<i32>,
        index: i32,
    ) -> Result<IdObject> {
        todo!();
        // let id = if let Some(b) = Movie::find()
        //     .filter(book::Column::OpenLibraryKey.eq(identifier))
        //     .one(&self.db)
        //     .await
        //     .unwrap()
        // {
        //     b.metadata_id
        // } else {
        //     let book_details = self
        //         .tmpdb_service
        //         .details(identifier, query, offset, index)
        //         .await
        //         .unwrap();
        //     let metadata = metadata::ActiveModel {
        //         lot: ActiveValue::Set(MetadataLot::Movie),
        //         title: ActiveValue::Set(book_details.title),
        //         description: ActiveValue::Set(book_details.description),
        //         publish_year: ActiveValue::Set(book_details.publish_year),
        //         ..Default::default()
        //     };
        //     let metadata = metadata.insert(&self.db).await.unwrap();
        //     for image in book_details.images.into_iter() {
        //         if let Some(c) = MetadataImage::find()
        //             .filter(metadata_image::Column::Url.eq(&image))
        //             .one(&self.db)
        //             .await
        //             .unwrap()
        //         {
        //             c
        //         } else {
        //             let c = metadata_image::ActiveModel {
        //                 url: ActiveValue::Set(image),
        //                 lot: ActiveValue::Set(MetadataImageLot::Poster),
        //                 metadata_id: ActiveValue::Set(metadata.id),
        //                 ..Default::default()
        //             };
        //             c.insert(&self.db).await.unwrap()
        //         };
        //     }
        //     for name in book_details.author_names.into_iter() {
        //         let creator = if let Some(c) = Creator::find()
        //             .filter(creator::Column::Name.eq(&name))
        //             .one(&self.db)
        //             .await
        //             .unwrap()
        //         {
        //             c
        //         } else {
        //             let c = creator::ActiveModel {
        //                 name: ActiveValue::Set(name),
        //                 ..Default::default()
        //             };
        //             c.insert(&self.db).await.unwrap()
        //         };
        //         let metadata_creator = metadata_to_creator::ActiveModel {
        //             metadata_id: ActiveValue::Set(metadata.id),
        //             creator_id: ActiveValue::Set(creator.id),
        //         };
        //         metadata_creator.insert(&self.db).await.unwrap();
        //     }
        //     let book = book::ActiveModel {
        //         metadata_id: ActiveValue::Set(metadata.id),
        //         open_library_key: ActiveValue::Set(book_details.identifier),
        //         num_pages: ActiveValue::Set(book_details.specifics.runtime),
        //     };
        //     let book = book.insert(&self.db).await.unwrap();
        //     book.metadata_id
        // };
        // Ok(IdObject { id })
    }
}
