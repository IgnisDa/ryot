use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};

use crate::{
    entities::{prelude::VideoGame, video_game},
    graphql::IdObject,
    media::{
        resolver::{MediaDetails, MediaSearchResults, MediaService, SearchInput},
        MediaSpecifics,
    },
    migrator::MetadataLot,
    traits::MediaProvider,
};

use super::igdb::IgdbService;

#[derive(Default)]
pub struct VideoGamesQuery;

#[Object]
impl VideoGamesQuery {
    /// Search for a list of games by a particular search query and a given page.
    async fn video_games_search(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<MediaSearchResults> {
        gql_ctx
            .data_unchecked::<VideoGamesService>()
            .video_game_search(&input.query, input.page)
            .await
    }
}

#[derive(Default)]
pub struct VideoGamesMutation;

#[Object]
impl VideoGamesMutation {
    /// Fetch details about a game and create a media item in the database.
    async fn commit_video_game(
        &self,
        gql_ctx: &Context<'_>,
        identifier: String,
    ) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<VideoGamesService>()
            .commit_video_game(&identifier)
            .await
    }
}

#[derive(Debug, Clone)]
pub struct VideoGamesService {
    db: DatabaseConnection,
    igdb_service: Arc<IgdbService>,
    media_service: Arc<MediaService>,
}

impl VideoGamesService {
    pub fn new(
        db: &DatabaseConnection,
        igdb_service: &IgdbService,
        media_service: &MediaService,
    ) -> Self {
        Self {
            igdb_service: Arc::new(igdb_service.clone()),
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl VideoGamesService {
    // Get movie details from all sources
    async fn video_game_search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<MediaSearchResults> {
        let movies = self.igdb_service.search(query, page).await?;
        Ok(movies)
    }

    pub async fn commit_video_game(&self, identifier: &str) -> Result<IdObject> {
        let meta = VideoGame::find()
            .filter(video_game::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject {
                id: m.metadata_id.into(),
            })
        } else {
            let details = self.igdb_service.details(identifier).await?;
            self.save_to_db(details).await
        }
    }

    pub async fn save_to_db(&self, details: MediaDetails) -> Result<IdObject> {
        let metadata_id = self
            .media_service
            .commit_media(
                MetadataLot::VideoGame,
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
            MediaSpecifics::VideoGame(s) => {
                let game = video_game::ActiveModel {
                    metadata_id: ActiveValue::Set(metadata_id),
                    identifier: ActiveValue::Set(details.identifier),
                    source: ActiveValue::Set(s.source),
                };
                game.insert(&self.db).await.unwrap();
                Ok(IdObject {
                    id: metadata_id.into(),
                })
            }
            _ => unreachable!(),
        }
    }
}
