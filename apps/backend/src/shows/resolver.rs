use std::sync::Arc;

use async_graphql::{Context, InputObject, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use serde::{Deserialize, Serialize};

use crate::{
    entities::{prelude::Show, show},
    graphql::IdObject,
    media::resolver::{MediaSearchResults, MediaService},
    migrator::{MetadataLot, ShowSource},
};

use super::{tmdb::TmdbService, ShowSpecifics};

#[derive(Serialize, Deserialize, Debug, InputObject)]
pub struct ShowSearchInput {
    query: String,
    page: Option<i32>,
}

#[derive(Default)]
pub struct ShowsQuery;

#[Object]
impl ShowsQuery {
    /// Search for a list of show by a particular search query and a given page.
    async fn show_search(
        &self,
        gql_ctx: &Context<'_>,
        input: ShowSearchInput,
    ) -> Result<MediaSearchResults> {
        gql_ctx
            .data_unchecked::<ShowsService>()
            .show_search(&input.query, input.page)
            .await
    }
}

#[derive(Default)]
pub struct ShowsMutation;

#[Object]
impl ShowsMutation {
    /// Fetch details about a show and create a media item in the database
    async fn commit_show(&self, gql_ctx: &Context<'_>, identifier: String) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<ShowsService>()
            .commit_show(&identifier)
            .await
    }
}

#[derive(Debug)]
pub struct ShowsService {
    db: DatabaseConnection,
    tmdb_service: Arc<TmdbService>,
    media_service: Arc<MediaService>,
}

impl ShowsService {
    pub fn new(
        db: &DatabaseConnection,
        tmdb_service: &TmdbService,

        media_service: &MediaService,
    ) -> Self {
        Self {
            tmdb_service: Arc::new(tmdb_service.clone()),
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl ShowsService {
    // Get show details from all sources
    async fn show_search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let movies = self.tmdb_service.search(query, page).await.unwrap();
        Ok(movies)
    }

    async fn commit_show(&self, identifier: &str) -> Result<IdObject> {
        let meta = Show::find()
            .filter(show::Column::TmdbId.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.metadata_id })
        } else {
            let show_details = self.tmdb_service.show_details(identifier).await.unwrap();
            let show_metadata_id = self
                .media_service
                .commit_media(
                    MetadataLot::Show,
                    show_details.title,
                    show_details.description,
                    show_details.publish_year,
                    show_details.publish_date,
                    show_details.poster_images,
                    show_details.backdrop_images,
                    show_details.author_names,
                )
                .await?;
            let show = show::ActiveModel {
                metadata_id: ActiveValue::Set(show_metadata_id),
                tmdb_id: ActiveValue::Set(show_details.identifier),
                details: ActiveValue::Set(ShowSpecifics {
                    seasons: show_details.show_specifics.clone().unwrap().seasons,
                }),
                source: ActiveValue::Set(ShowSource::Tmdb),
            };
            let show = show.insert(&self.db).await.unwrap();
            Ok(IdObject {
                id: show.metadata_id,
            })
        }
    }
}
