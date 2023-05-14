use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};

use crate::{
    entities::{podcast, prelude::VideoGame, video_game},
    graphql::IdObject,
    media::{
        resolver::{MediaDetails, MediaSearchResults, MediaService, SearchInput},
        MediaSpecifics,
    },
    migrator::MetadataLot,
    traits::MediaProvider,
};

use super::listennotes::ListennotesService;

#[derive(Default)]
pub struct PodcastsQuery;

#[Object]
impl PodcastsQuery {
    /// Search for a list of games by a particular search query and a given page.
    async fn podcasts_search(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<MediaSearchResults> {
        gql_ctx
            .data_unchecked::<PodcastsService>()
            .podcasts_search(&input.query, input.page)
            .await
    }
}

#[derive(Default)]
pub struct PodcastsMutation;

#[Object]
impl PodcastsMutation {
    /// Fetch details about a game and create a media item in the database
    async fn commit_podcast(&self, gql_ctx: &Context<'_>, identifier: String) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<PodcastsService>()
            .commit_video_game(&identifier)
            .await
    }
}

#[derive(Debug, Clone)]
pub struct PodcastsService {
    db: DatabaseConnection,
    listennotes_service: Arc<ListennotesService>,
    media_service: Arc<MediaService>,
}

impl PodcastsService {
    pub fn new(
        db: &DatabaseConnection,
        listennotes_service: &ListennotesService,
        media_service: &MediaService,
    ) -> Self {
        Self {
            listennotes_service: Arc::new(listennotes_service.clone()),
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl PodcastsService {
    // Get podcasts details from all sources
    async fn podcasts_search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let movies = self.listennotes_service.search(query, page).await?;
        Ok(movies)
    }

    pub async fn commit_video_game(&self, identifier: &str) -> Result<IdObject> {
        let meta = VideoGame::find()
            .filter(video_game::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.metadata_id })
        } else {
            let details = self.listennotes_service.details(identifier).await?;
            self.save_to_db(details).await
        }
    }

    pub async fn save_to_db(&self, details: MediaDetails) -> Result<IdObject> {
        let metadata_id = self
            .media_service
            .commit_media(
                MetadataLot::Podcast,
                details.title,
                details.description,
                details.publish_year,
                details.publish_date,
                details.poster_images,
                details.backdrop_images,
                details.creators,
                details.genres,
            )
            .await?;
        match details.specifics {
            MediaSpecifics::Podcast(s) => {
                let podcast = podcast::ActiveModel {
                    metadata_id: ActiveValue::Set(metadata_id),
                    identifier: ActiveValue::Set(details.identifier),
                    source: ActiveValue::Set(s.source),
                    details: ActiveValue::Set(s),
                };
                podcast.insert(&self.db).await.unwrap();
                Ok(IdObject { id: metadata_id })
            }
            _ => unreachable!(),
        }
    }
}
