use std::sync::Arc;

use async_graphql::{Context, Error, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};

use crate::{
    entities::{
        metadata,
        prelude::{Metadata, VideoGame},
        video_game,
    },
    graphql::IdObject,
    media::{
        resolver::{MediaDetails, MediaSearchResults, MediaService, SearchInput},
        MediaSpecifics,
    },
    migrator::{MetadataLot, MetadataSource},
    traits::MediaProvider,
};

use super::{igdb::IgdbService, VideoGameSpecifics};

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

    pub async fn details_from_provider(&self, metadata_id: i32) -> Result<MediaDetails> {
        let (metadata, additional_details) = Metadata::find_by_id(metadata_id)
            .find_also_related(VideoGame)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let additional_details = additional_details.unwrap();
        let details = match metadata.source {
            MetadataSource::Igdb => self.igdb_service.details(&metadata.identifier).await?,
            MetadataSource::Custom => {
                return Err(Error::new(
                    "Getting details for custom provider is not supported".to_owned(),
                ))
            }
            _ => unreachable!(),
        };
        Ok(details)
    }

    pub async fn commit_video_game(&self, identifier: &str) -> Result<IdObject> {
        let meta = Metadata::find()
            .filter(metadata::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.id.into() })
        } else {
            let details = self.igdb_service.details(identifier).await?;
            self.save_to_db(details).await
        }
    }

    pub async fn save_to_db(&self, details: MediaDetails) -> Result<IdObject> {
        let metadata_id = self
            .media_service
            .commit_media(
                details.identifier.clone(),
                MetadataLot::VideoGame,
                details.title,
                details.description,
                details.publish_year,
                details.publish_date,
                details.images,
                details.creators,
                details.genres,
            )
            .await?;
        match details.specifics {
            MediaSpecifics::VideoGame(s) => {
                let game = video_game::ActiveModel {
                    metadata_id: ActiveValue::Set(metadata_id),
                    details: ActiveValue::Set(s),
                    ..Default::default()
                };
                game.insert(&self.db).await.unwrap();
                Ok(IdObject {
                    id: metadata_id.into(),
                })
            }
            _ => unreachable!(),
        }
    }

    pub async fn update_details(&self, media_id: i32, details: VideoGameSpecifics) -> Result<()> {
        let media = VideoGame::find_by_id(media_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let mut media: video_game::ActiveModel = media.into();
        media.details = ActiveValue::Set(details);
        media.save(&self.db).await.ok();
        Ok(())
    }
}
