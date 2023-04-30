use async_graphql::{Context, Enum, Error, InputObject, Object, Result, SimpleObject};
use chrono::{NaiveDate, Utc};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait,
    PaginatorTrait, QueryFilter, QueryOrder,
};
use serde::{Deserialize, Serialize};

use crate::{
    books::BookSpecifics,
    entities::{
        book, creator, episode,
        metadata::{self, Model as MetadataModel},
        metadata_image, metadata_to_creator, movie,
        prelude::{
            Book, Creator, Episode, Metadata, MetadataImage, Movie, Season, Seen, Show,
            UserToMetadata,
        },
        season, seen, show, user_to_metadata,
    },
    graphql::IdObject,
    migrator::{MetadataImageLot, MetadataLot},
    movies::MovieSpecifics,
    shows::{ShowEpisode, ShowSeason, ShowSpecifics},
    utils::user_id_from_ctx,
};

use super::{SeenStatus, LIMIT};

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaSearchItem {
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub author_names: Vec<String>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
    pub publish_year: Option<i32>,
    pub publish_date: Option<NaiveDate>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub show_specifics: Option<ShowSpecifics>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
pub struct MediaSearchResults {
    pub total: i32,
    pub items: Vec<MediaSearchItem>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaSeen {
    pub identifier: String,
    pub seen: SeenStatus,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy)]
pub enum ProgressUpdateAction {
    Update,
    Now,
    InThePast,
    JustStarted,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct ProgressUpdate {
    pub metadata_id: i32,
    pub progress: Option<i32>,
    pub action: ProgressUpdateAction,
    pub date: Option<NaiveDate>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaDetails {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    #[graphql(name = "type")]
    pub lot: MetadataLot,
    pub creators: Vec<String>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
    pub publish_year: Option<i32>,
    pub publish_date: Option<NaiveDate>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub show_specifics: Option<ShowSpecifics>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaConsumedInput {
    pub identifier: String,
    pub lot: MetadataLot,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaListInput {
    pub page: i32,
    pub lot: MetadataLot,
}

#[derive(Default)]
pub struct MediaQuery;

#[Object]
impl MediaQuery {
    /// Get details about a media present in the database
    async fn media_details(&self, gql_ctx: &Context<'_>, metadata_id: i32) -> Result<MediaDetails> {
        gql_ctx
            .data_unchecked::<MediaService>()
            .media_details(metadata_id)
            .await
    }

    /// Get the user's seen history for a particular media item
    async fn seen_history(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: i32,
        #[graphql(default = false)] is_show: bool,
    ) -> Result<Vec<seen::Model>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .seen_history(metadata_id, user_id, is_show)
            .await
    }

    /// Check whether a media item has been consumed before
    async fn media_consumed(
        &self,
        gql_ctx: &Context<'_>,
        input: MediaConsumedInput,
    ) -> Result<MediaSeen> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .media_consumed(user_id, input)
            .await
    }

    /// Get all the media items for a specific media type
    async fn media_list(
        &self,
        gql_ctx: &Context<'_>,
        input: MediaListInput,
    ) -> Result<MediaSearchResults> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .media_list(user_id, input)
            .await
    }
}

#[derive(Default)]
pub struct MediaMutation;

#[Object]
impl MediaMutation {
    /// Mark a user's progress on a specific media item
    async fn progress_update(
        &self,
        gql_ctx: &Context<'_>,
        input: ProgressUpdate,
    ) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .progress_update(input, user_id)
            .await
    }

    /// Delete a seen item from a user's history
    async fn delete_seen_item(&self, gql_ctx: &Context<'_>, seen_id: i32) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .delete_seen_item(seen_id, user_id)
            .await
    }
}

#[derive(Debug, Clone)]
pub struct MediaService {
    db: DatabaseConnection,
}

impl MediaService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
}

impl MediaService {
    async fn metadata_images(&self, meta: &MetadataModel) -> Result<(Vec<String>, Vec<String>)> {
        let images = meta
            .find_related(MetadataImage)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>();
        let poster_images = images
            .iter()
            .filter(|f| f.lot == MetadataImageLot::Poster)
            .map(|i| i.url.clone())
            .collect();
        let backdrop_images = images
            .iter()
            .filter(|f| f.lot == MetadataImageLot::Backdrop)
            .map(|i| i.url.clone())
            .collect();
        Ok((poster_images, backdrop_images))
    }

    async fn generic_metadata(
        &self,
        metadata_id: i32,
    ) -> Result<(MetadataModel, Vec<String>, Vec<String>, Vec<String>)> {
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
        let (poster_images, backdrop_images) = self.metadata_images(&meta).await.unwrap();
        Ok((meta, creators, poster_images, backdrop_images))
    }

    async fn media_details(&self, metadata_id: i32) -> Result<MediaDetails> {
        let (meta, creators, poster_images, backdrop_images) =
            self.generic_metadata(metadata_id).await?;
        let mut resp = MediaDetails {
            id: meta.id,
            title: meta.title,
            description: meta.description,
            publish_year: meta.publish_year,
            publish_date: meta.publish_date,
            lot: meta.lot,
            creators,
            poster_images,
            backdrop_images,
            book_specifics: None,
            movie_specifics: None,
            show_specifics: None,
        };
        match meta.lot {
            MetadataLot::Book => {
                let additional = Book::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.book_specifics = Some(BookSpecifics {
                    pages: additional.num_pages,
                });
            }
            MetadataLot::Movie => {
                let additional = Movie::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.movie_specifics = Some(MovieSpecifics {
                    runtime: additional.runtime,
                });
            }
            MetadataLot::Show => {
                let additional = Show::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                let mut seasons = vec![];
                let db_seasons = additional
                    .find_related(Season)
                    .order_by_asc(season::Column::Number)
                    .all(&self.db)
                    .await
                    .unwrap();
                for season in db_seasons {
                    let mut episodes = vec![];
                    let s = season
                        .find_related(Metadata)
                        .one(&self.db)
                        .await
                        .unwrap()
                        .unwrap();
                    let db_episodes = season
                        .find_related(Episode)
                        .order_by_asc(episode::Column::Number)
                        .all(&self.db)
                        .await
                        .unwrap();
                    for episode in db_episodes {
                        let s = episode
                            .find_related(Metadata)
                            .one(&self.db)
                            .await
                            .unwrap()
                            .unwrap();
                        episodes.push(ShowEpisode {
                            id: s.id,
                            episode_number: episode.number,
                            name: s.title,
                            overview: s.description,
                            publish_date: s.publish_date,
                        })
                    }
                    let (poster_images, backdrop_images) = self.metadata_images(&s).await.unwrap();
                    seasons.push(ShowSeason {
                        id: s.id,
                        season_number: season.number,
                        name: s.title,
                        overview: s.description,
                        publish_date: s.publish_date,
                        episodes,
                        poster_images,
                        backdrop_images,
                    })
                }
                resp.show_specifics = Some(ShowSpecifics { seasons });
            }
            _ => todo!(),
        };
        Ok(resp)
    }

    async fn seen_history(
        &self,
        metadata_id: i32,
        user_id: i32,
        is_show: bool,
    ) -> Result<Vec<seen::Model>> {
        let prev_seen = if is_show {
            let seasons = Season::find()
                .filter(season::Column::ShowId.eq(metadata_id))
                .all(&self.db)
                .await
                .unwrap()
                .into_iter()
                .map(|s| s.metadata_id)
                .collect::<Vec<_>>();
            let episodes = Episode::find()
                .filter(episode::Column::SeasonId.is_in(seasons))
                .all(&self.db)
                .await
                .unwrap()
                .into_iter()
                .map(|s| s.metadata_id)
                .collect::<Vec<_>>();
            Seen::find()
                .filter(seen::Column::UserId.eq(user_id))
                .filter(seen::Column::MetadataId.is_in(episodes))
                .order_by_desc(seen::Column::LastUpdatedOn)
                .all(&self.db)
                .await
                .unwrap()
        } else {
            Seen::find()
                .filter(seen::Column::UserId.eq(user_id))
                .filter(seen::Column::MetadataId.eq(metadata_id))
                .order_by_desc(seen::Column::LastUpdatedOn)
                .all(&self.db)
                .await
                .unwrap()
        };
        Ok(prev_seen)
    }

    pub async fn media_consumed(
        &self,
        user_id: i32,
        input: MediaConsumedInput,
    ) -> Result<MediaSeen> {
        let media = match input.lot {
            MetadataLot::Book => Book::find()
                .filter(book::Column::OpenLibraryKey.eq(&input.identifier))
                .one(&self.db)
                .await
                .unwrap()
                .map(|b| b.metadata_id),
            MetadataLot::Movie => Movie::find()
                .filter(movie::Column::TmdbId.eq(&input.identifier))
                .one(&self.db)
                .await
                .unwrap()
                .map(|b| b.metadata_id),
            MetadataLot::Show => Show::find()
                .filter(show::Column::TmdbId.eq(&input.identifier))
                .one(&self.db)
                .await
                .unwrap()
                .map(|b| b.metadata_id),
            _ => todo!(),
        };
        let resp = if let Some(m) = media {
            let seen = Seen::find()
                .filter(seen::Column::UserId.eq(user_id))
                .filter(seen::Column::MetadataId.eq(media))
                .order_by_asc(seen::Column::LastUpdatedOn)
                .all(&self.db)
                .await
                .unwrap();
            let filtered = seen
                .iter()
                .filter(|b| b.metadata_id == m)
                .collect::<Vec<_>>();
            let is_there = if filtered.is_empty() {
                SeenStatus::NotConsumed
            } else if filtered.last().unwrap().progress < 100 {
                SeenStatus::CurrentlyUnderway
            } else {
                SeenStatus::ConsumedAtleastOnce
            };
            MediaSeen {
                identifier: input.identifier,
                seen: is_there,
            }
        } else {
            MediaSeen {
                identifier: input.identifier,
                seen: SeenStatus::NotInDatabase,
            }
        };
        Ok(resp)
    }

    pub async fn media_list(
        &self,
        user_id: i32,
        input: MediaListInput,
    ) -> Result<MediaSearchResults> {
        let meta = UserToMetadata::find()
            .filter(user_to_metadata::Column::UserId.eq(user_id))
            .all(&self.db)
            .await
            .unwrap();
        let distinct_meta_ids = meta.into_iter().map(|m| m.metadata_id).collect::<Vec<_>>();
        let condition = Metadata::find()
            .filter(metadata::Column::Lot.eq(input.lot))
            .filter(metadata::Column::Id.is_in(distinct_meta_ids));
        let counts = condition.clone().count(&self.db).await.unwrap();
        let paginator = condition.paginate(&self.db, LIMIT as u64);
        let metas = paginator.fetch_page((input.page - 1) as u64).await.unwrap();
        let mut items = vec![];
        for m in metas {
            let mut images = Metadata::find_by_id(m.id)
                .find_with_related(MetadataImage)
                .all(&self.db)
                .await
                .unwrap();
            let images = images.remove(0).1;
            let poster_images = images
                .iter()
                .filter(|f| f.lot == MetadataImageLot::Poster)
                .map(|i| i.url.clone())
                .collect();
            let backdrop_images = images
                .iter()
                .filter(|f| f.lot == MetadataImageLot::Backdrop)
                .map(|i| i.url.clone())
                .collect();
            let _m = MediaSearchItem {
                identifier: m.id.to_string(),
                title: m.title,
                description: m.description,
                author_names: vec![],
                poster_images,
                backdrop_images,
                publish_year: m.publish_year,
                publish_date: m.publish_date,
                book_specifics: None,
                movie_specifics: None,
                show_specifics: None,
            };
            items.push(_m);
        }
        Ok(MediaSearchResults {
            total: counts as i32,
            items,
        })
    }

    pub async fn progress_update(&self, input: ProgressUpdate, user_id: i32) -> Result<IdObject> {
        let user_to_meta = user_to_metadata::ActiveModel {
            user_id: ActiveValue::Set(user_id),
            metadata_id: ActiveValue::Set(input.metadata_id),
            ..Default::default()
        };
        // we do not care if it succeeded or failed, since we need just one instance
        user_to_meta.insert(&self.db).await.ok();
        let prev_seen = Seen::find()
            .filter(seen::Column::Progress.lt(100))
            .filter(seen::Column::UserId.eq(user_id))
            .filter(seen::Column::MetadataId.eq(input.metadata_id))
            .order_by_desc(seen::Column::LastUpdatedOn)
            .all(&self.db)
            .await
            .unwrap();
        let seen_item = match input.action {
            ProgressUpdateAction::Update => {
                if prev_seen.len() != 1 {
                    return Err(Error::new("There is no `seen` item underway".to_owned()));
                }
                let progress = input.progress.unwrap();
                let mut last_seen: seen::ActiveModel = prev_seen[0].clone().into();
                last_seen.progress = ActiveValue::Set(progress);
                last_seen.last_updated_on = ActiveValue::Set(Utc::now());
                if progress == 100 {
                    last_seen.finished_on = ActiveValue::Set(Some(Utc::now().date_naive()));
                }
                last_seen.update(&self.db).await.unwrap()
            }
            ProgressUpdateAction::Now
            | ProgressUpdateAction::InThePast
            | ProgressUpdateAction::JustStarted => {
                let finished_on = if input.action == ProgressUpdateAction::Now {
                    Some(Utc::now().date_naive())
                } else {
                    input.date
                };
                let (progress, started_on) =
                    if matches!(input.action, ProgressUpdateAction::JustStarted) {
                        (0, Some(Utc::now().date_naive()))
                    } else {
                        (100, None)
                    };
                let seen_ins = seen::ActiveModel {
                    progress: ActiveValue::Set(progress),
                    user_id: ActiveValue::Set(user_id),
                    metadata_id: ActiveValue::Set(input.metadata_id),
                    started_on: ActiveValue::Set(started_on),
                    finished_on: ActiveValue::Set(finished_on),
                    last_updated_on: ActiveValue::Set(Utc::now()),
                    ..Default::default()
                };
                seen_ins.insert(&self.db).await.unwrap()
            }
        };
        Ok(IdObject { id: seen_item.id })
    }

    pub async fn delete_seen_item(&self, seen_id: i32, user_id: i32) -> Result<IdObject> {
        let seen_item = Seen::find_by_id(seen_id).one(&self.db).await.unwrap();
        if let Some(si) = seen_item {
            let id = si.id;
            if si.user_id != user_id {
                return Err(Error::new(
                    "This seen item does not belong to this user".to_owned(),
                ));
            }
            si.delete(&self.db).await.ok();
            Ok(IdObject { id })
        } else {
            Err(Error::new("This seen item does not exist".to_owned()))
        }
    }

    pub async fn commit_media(
        &self,
        lot: MetadataLot,
        title: String,
        description: Option<String>,
        publish_year: Option<i32>,
        publish_date: Option<NaiveDate>,
        poster_images: Vec<String>,
        backdrop_images: Vec<String>,
        creator_names: Vec<String>,
    ) -> Result<i32> {
        let metadata = metadata::ActiveModel {
            lot: ActiveValue::Set(lot),
            title: ActiveValue::Set(title),
            description: ActiveValue::Set(description),
            publish_year: ActiveValue::Set(publish_year),
            publish_date: ActiveValue::Set(publish_date),
            ..Default::default()
        };
        let metadata = metadata.insert(&self.db).await.unwrap();
        for image in poster_images.iter() {
            if let Some(c) = MetadataImage::find()
                .filter(metadata_image::Column::Url.eq(image))
                .one(&self.db)
                .await
                .unwrap()
            {
                c
            } else {
                let c = metadata_image::ActiveModel {
                    url: ActiveValue::Set(image.to_owned()),
                    lot: ActiveValue::Set(MetadataImageLot::Poster),
                    metadata_id: ActiveValue::Set(metadata.id),
                    ..Default::default()
                };
                c.insert(&self.db).await.unwrap()
            };
        }
        for image in backdrop_images.iter() {
            if let Some(c) = MetadataImage::find()
                .filter(metadata_image::Column::Url.eq(image))
                .one(&self.db)
                .await
                .unwrap()
            {
                c
            } else {
                let c = metadata_image::ActiveModel {
                    url: ActiveValue::Set(image.to_owned()),
                    lot: ActiveValue::Set(MetadataImageLot::Backdrop),
                    metadata_id: ActiveValue::Set(metadata.id),
                    ..Default::default()
                };
                c.insert(&self.db).await.unwrap()
            };
        }
        for name in creator_names.iter() {
            let creator = if let Some(c) = Creator::find()
                .filter(creator::Column::Name.eq(name))
                .one(&self.db)
                .await
                .unwrap()
            {
                c
            } else {
                let c = creator::ActiveModel {
                    name: ActiveValue::Set(name.to_owned()),
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
        Ok(metadata.id)
    }
}
