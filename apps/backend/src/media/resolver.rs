use apalis::{prelude::Storage, sqlite::SqliteStorage};
use async_graphql::{Context, Enum, Error, InputObject, Object, Result, SimpleObject};
use chrono::{NaiveDate, Utc};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait, DatabaseBackend,
    DatabaseConnection, EntityTrait, FromQueryResult, Iden, JoinType, ModelTrait, Order,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Statement,
};
use sea_query::{
    Alias, Cond, Expr, Func, MySqlQueryBuilder, PostgresQueryBuilder, Query, SelectStatement,
    SqliteQueryBuilder,
};
use serde::{Deserialize, Serialize};

use crate::{
    audio_books::AudioBookSpecifics,
    background::{AfterMediaSeenJob, RecalculateUserSummaryJob, UpdateMetadataJob},
    books::BookSpecifics,
    entities::{
        collection, genre, metadata, metadata_to_collection, metadata_to_genre,
        prelude::{
            AudioBook, Book, Collection, Genre, Metadata, MetadataToCollection, Movie, Podcast,
            Review, Seen, Show, UserToMetadata, VideoGame,
        },
        review, seen, user_to_metadata,
        utils::{SeenExtraInformation, SeenPodcastExtraInformation, SeenShowExtraInformation},
    },
    graphql::{IdObject, Identifier},
    media::PAGE_LIMIT,
    migrator::{MetadataImageLot, MetadataLot},
    movies::MovieSpecifics,
    podcasts::PodcastSpecifics,
    shows::ShowSpecifics,
    utils::user_id_from_ctx,
    video_games::VideoGameSpecifics,
};

use super::{MediaSpecifics, MetadataCreator, MetadataCreators, MetadataImage, MetadataImages};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaBaseData {
    pub model: metadata::Model,
    pub creators: Vec<MetadataCreator>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
    pub genres: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaSearchItem {
    pub identifier: String,
    pub lot: MetadataLot,
    pub title: String,
    pub poster_images: Vec<String>,
    pub publish_year: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
pub struct MediaSearchResults {
    pub total: i32,
    pub items: Vec<MediaSearchItem>,
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
    pub metadata_id: Identifier,
    pub progress: Option<i32>,
    pub action: ProgressUpdateAction,
    pub date: Option<NaiveDate>,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
    /// If this update comes from a different source, this should be set
    pub identifier: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaDetails {
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub lot: MetadataLot,
    pub creators: Vec<MetadataCreator>,
    pub genres: Vec<String>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
    pub publish_year: Option<i32>,
    pub publish_date: Option<NaiveDate>,
    pub specifics: MediaSpecifics,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct DatabaseMediaDetails {
    pub id: i32,
    pub title: String,
    pub identifier: String,
    pub description: Option<String>,
    pub lot: MetadataLot,
    pub creators: Vec<MetadataCreator>,
    pub genres: Vec<String>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
    pub publish_year: Option<i32>,
    pub publish_date: Option<NaiveDate>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub show_specifics: Option<ShowSpecifics>,
    pub video_game_specifics: Option<VideoGameSpecifics>,
    pub audio_book_specifics: Option<AudioBookSpecifics>,
    pub podcast_specifics: Option<PodcastSpecifics>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum MediaSortOrder {
    Desc,
    #[default]
    Asc,
}

impl From<MediaSortOrder> for Order {
    fn from(value: MediaSortOrder) -> Self {
        match value {
            MediaSortOrder::Desc => Self::Desc,
            MediaSortOrder::Asc => Self::Asc,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum MediaSortBy {
    Title,
    #[default]
    ReleaseDate,
    LastSeen,
    Rating,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaSortInput {
    #[graphql(default)]
    pub order: MediaSortOrder,
    #[graphql(default)]
    pub by: MediaSortBy,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq)]
pub enum MediaFilter {
    All,
    Rated,
    Unrated,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaListInput {
    pub page: i32,
    pub lot: MetadataLot,
    pub sort: Option<MediaSortInput>,
    pub query: Option<String>,
    pub filter: Option<MediaFilter>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaConsumedInput {
    pub identifier: String,
    pub lot: MetadataLot,
}

#[derive(Serialize, Deserialize, Debug, InputObject)]
pub struct SearchInput {
    pub query: String,
    pub page: Option<i32>,
}

#[derive(Default)]
pub struct MediaQuery;

#[Object]
impl MediaQuery {
    /// Get details about a media present in the database.
    async fn media_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: Identifier,
    ) -> Result<DatabaseMediaDetails> {
        gql_ctx
            .data_unchecked::<MediaService>()
            .media_details(metadata_id.into())
            .await
    }

    /// Get the user's seen history for a particular media item.
    async fn seen_history(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: Identifier,
    ) -> Result<Vec<seen::Model>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .seen_history(metadata_id.into(), user_id)
            .await
    }

    /// Get all the media items related to a user for a specific media type.
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
    /// Mark a user's progress on a specific media item.
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

    /// Deploy a job to update a media item's metadata.
    async fn deploy_update_metadata_job(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: Identifier,
    ) -> Result<String> {
        gql_ctx
            .data_unchecked::<MediaService>()
            .deploy_update_metadata_job(metadata_id.into())
            .await
    }
}

#[derive(Debug, Clone)]
pub struct MediaService {
    db: DatabaseConnection,
    after_media_seen: SqliteStorage<AfterMediaSeenJob>,
    update_metadata: SqliteStorage<UpdateMetadataJob>,
    recalculate_user_summary: SqliteStorage<RecalculateUserSummaryJob>,
}

impl MediaService {
    pub fn new(
        db: &DatabaseConnection,
        after_media_seen: &SqliteStorage<AfterMediaSeenJob>,
        update_metadata: &SqliteStorage<UpdateMetadataJob>,
        recalculate_user_summary: &SqliteStorage<RecalculateUserSummaryJob>,
    ) -> Self {
        Self {
            db: db.clone(),
            after_media_seen: after_media_seen.clone(),
            update_metadata: update_metadata.clone(),
            recalculate_user_summary: recalculate_user_summary.clone(),
        }
    }
}

impl MediaService {
    async fn metadata_images(&self, meta: &metadata::Model) -> Result<(Vec<String>, Vec<String>)> {
        let images = meta.images.0.clone();
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

    pub async fn generic_metadata(&self, metadata_id: i32) -> Result<MediaBaseData> {
        let meta = match Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
        {
            Some(m) => m,
            None => return Err(Error::new("The record does not exit".to_owned())),
        };
        let genres = meta
            .find_related(Genre)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|g| g.name)
            .collect();
        let creators = meta.creators.clone().0;
        let (poster_images, backdrop_images) = self.metadata_images(&meta).await.unwrap();
        Ok(MediaBaseData {
            model: meta,
            creators,
            poster_images,
            backdrop_images,
            genres,
        })
    }

    async fn media_details(&self, metadata_id: i32) -> Result<DatabaseMediaDetails> {
        let MediaBaseData {
            model,
            creators,
            poster_images,
            backdrop_images,
            genres,
        } = self.generic_metadata(metadata_id).await?;
        let mut resp = DatabaseMediaDetails {
            id: model.id,
            title: model.title,
            identifier: model.identifier,
            description: model.description,
            publish_year: model.publish_year,
            publish_date: model.publish_date,
            lot: model.lot,
            creators,
            genres,
            poster_images,
            backdrop_images,
            book_specifics: None,
            movie_specifics: None,
            show_specifics: None,
            video_game_specifics: None,
            audio_book_specifics: None,
            podcast_specifics: None,
        };
        match model.lot {
            MetadataLot::AudioBook => {
                let additional = AudioBook::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.audio_book_specifics = Some(AudioBookSpecifics {
                    runtime: additional.runtime,
                    source: additional.source,
                });
            }
            MetadataLot::Book => {
                let additional = Book::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.book_specifics = Some(BookSpecifics {
                    pages: additional.num_pages,
                    source: additional.source,
                });
            }
            MetadataLot::Podcast => {
                let additional = Podcast::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.podcast_specifics = Some(additional.details);
            }
            MetadataLot::Movie => {
                let additional = Movie::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.movie_specifics = Some(MovieSpecifics {
                    runtime: additional.runtime,
                    source: additional.source,
                });
            }
            MetadataLot::Show => {
                let additional = Show::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.show_specifics = Some(additional.details);
            }
            MetadataLot::VideoGame => {
                let additional = VideoGame::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.video_game_specifics = Some(VideoGameSpecifics {
                    source: additional.source,
                });
            }
        };
        Ok(resp)
    }

    async fn seen_history(&self, metadata_id: i32, user_id: i32) -> Result<Vec<seen::Model>> {
        let mut prev_seen = Seen::find()
            .filter(seen::Column::UserId.eq(user_id))
            .filter(seen::Column::MetadataId.eq(metadata_id))
            .order_by_desc(seen::Column::LastUpdatedOn)
            .all(&self.db)
            .await
            .unwrap();
        prev_seen.iter_mut().for_each(|s| {
            if let Some(i) = s.extra_information.as_ref() {
                match i {
                    SeenExtraInformation::Show(sea) => {
                        s.show_information = Some(sea.clone());
                    }
                    SeenExtraInformation::Podcast(sea) => {
                        s.podcast_information = Some(sea.clone());
                    }
                };
            }
        });
        Ok(prev_seen)
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

        #[derive(Iden)]
        #[iden = "metadata"]
        enum TempMetadata {
            Table,
            #[iden = "m"]
            Alias,
            Id,
            MetadataId,
            Lot,
        }
        #[derive(Iden)]
        #[iden = "seen"]
        enum TempSeen {
            Table,
            #[iden = "s"]
            Alias,
            MetadataId,
            LastUpdatedOn,
            LastSeen,
            UserId,
        }
        #[derive(Iden)]
        #[iden = "review"]
        enum TempReview {
            Table,
            #[iden = "r"]
            Alias,
            MetadataId,
            UserId,
            Rating,
        }

        let mut main_select = Query::select()
            .expr(Expr::table_asterisk(TempMetadata::Alias))
            .from_as(TempMetadata::Table, TempMetadata::Alias)
            .and_where(Expr::col((TempMetadata::Alias, TempMetadata::Lot)).eq(input.lot))
            .and_where(
                Expr::col((TempMetadata::Alias, TempMetadata::Id)).is_in(distinct_meta_ids.clone()),
            )
            .to_owned();

        if let Some(v) = input.query.clone() {
            main_select = main_select
                .cond_where(
                    Cond::any()
                        .add(
                            Expr::expr(Func::lower(Expr::col((
                                TempMetadata::Alias,
                                metadata::Column::Title,
                            ))))
                            .like(format!("%{}%", v)),
                        )
                        .add(
                            Expr::expr(Func::lower(Expr::col((
                                TempMetadata::Alias,
                                metadata::Column::Description,
                            ))))
                            .like(format!("%{}%", v)),
                        ),
                )
                .to_owned();
        };

        let order_by = input
            .sort
            .clone()
            .map(|a| Order::from(a.order))
            .unwrap_or(Order::Asc);

        match input.sort.clone() {
            None => {
                main_select = main_select
                    .order_by((TempMetadata::Alias, metadata::Column::Title), order_by)
                    .to_owned();
            }
            Some(s) => {
                match s.by {
                    MediaSortBy::Title => {
                        main_select = main_select
                            .order_by((TempMetadata::Alias, metadata::Column::Title), order_by)
                            .to_owned();
                    }
                    MediaSortBy::ReleaseDate => {
                        main_select = main_select
                            .order_by(
                                (TempMetadata::Alias, metadata::Column::PublishYear),
                                order_by,
                            )
                            .to_owned();
                    }
                    MediaSortBy::LastSeen => {
                        let sub_select = Query::select()
                            .column(TempSeen::MetadataId)
                            .expr_as(
                                Func::max(Expr::col(TempSeen::LastUpdatedOn)),
                                TempSeen::LastSeen,
                            )
                            .from(TempSeen::Table)
                            .and_where(Expr::col(TempSeen::UserId).eq(user_id))
                            .group_by_col(TempSeen::MetadataId)
                            .to_owned();
                        main_select = main_select
                            .join_subquery(
                                JoinType::Join,
                                sub_select,
                                TempSeen::Alias,
                                Expr::col((TempMetadata::Alias, TempMetadata::Id))
                                    .equals((TempSeen::Alias, TempMetadata::MetadataId)),
                            )
                            .order_by((TempSeen::Alias, TempSeen::LastSeen), order_by)
                            .to_owned();
                    }
                    MediaSortBy::Rating => {
                        main_select = main_select
                            .expr_as(
                                Func::coalesce([
                                    Func::avg(Expr::col((TempReview::Alias, TempReview::Rating)))
                                        .into(),
                                    Expr::value(0).into(),
                                ]),
                                Alias::new("average_rating"),
                            )
                            .join_as(
                                JoinType::LeftJoin,
                                TempReview::Table,
                                Alias::new("r"),
                                Expr::col((TempMetadata::Alias, TempMetadata::Id))
                                    .equals((TempReview::Alias, TempReview::MetadataId))
                                    .and(
                                        Expr::col((TempReview::Alias, TempReview::UserId))
                                            .eq(user_id),
                                    ),
                            )
                            .group_by_col((TempMetadata::Alias, TempMetadata::Id))
                            .order_by_expr(Expr::cust("average_rating").into(), order_by)
                            .to_owned();
                    }
                };
            }
        };

        match input.filter {
            None => {}
            Some(s) => {
                let reviews = if matches!(s, MediaFilter::All) {
                    vec![]
                } else {
                    Review::find()
                        .filter(review::Column::UserId.eq(user_id.clone()))
                        .all(&self.db)
                        .await?
                        .into_iter()
                        .map(|r| r.metadata_id)
                        .collect::<Vec<_>>()
                };
                match s {
                    MediaFilter::All => {}
                    MediaFilter::Rated => {
                        main_select = main_select
                            .and_where(Expr::col(TempMetadata::Id).is_in(reviews))
                            .to_owned();
                    }
                    MediaFilter::Unrated => {
                        main_select = main_select
                            .and_where(Expr::col(TempMetadata::Id).is_not_in(reviews))
                            .to_owned();
                    }
                }
            }
        };

        let get_sql_and_values = |stmt: SelectStatement| match self.db.get_database_backend() {
            DatabaseBackend::MySql => stmt.build(MySqlQueryBuilder {}),
            DatabaseBackend::Postgres => stmt.build(PostgresQueryBuilder {}),
            DatabaseBackend::Sqlite => stmt.build(SqliteQueryBuilder {}),
        };

        #[derive(Debug, FromQueryResult)]
        struct InnerMediaSearchItem {
            id: i32,
            lot: MetadataLot,
            title: String,
            publish_year: Option<i32>,
            images: String,
        }

        let count_select = Query::select()
            .expr(Func::count(Expr::asterisk()))
            .from_subquery(main_select.clone(), Alias::new("subquery"))
            .to_owned();

        let (count_sql, count_values) = get_sql_and_values(count_select);

        println!("{}", count_sql);

        let stmt = Statement::from_sql_and_values(
            self.db.get_database_backend(),
            &count_sql,
            count_values,
        );
        let total = self
            .db
            .query_one(stmt)
            .await?
            .map(|qr| qr.try_get_by_index::<i64>(0).unwrap())
            .unwrap();

        let main_select = main_select
            .limit(PAGE_LIMIT as u64)
            .offset((input.page - 1) as u64)
            .to_owned();

        let (sql, values) = get_sql_and_values(main_select);

        let stmt = Statement::from_sql_and_values(self.db.get_database_backend(), &sql, values);
        let metas: Vec<InnerMediaSearchItem> = self
            .db
            .query_all(stmt)
            .await?
            .into_iter()
            .map(|qr| InnerMediaSearchItem::from_query_result(&qr, "").unwrap())
            .collect();
        let mut items = vec![];
        for m in metas {
            let images = serde_json::from_str(&m.images).unwrap();
            let (poster_images, _) = self
                .metadata_images(&metadata::Model {
                    images,
                    ..Default::default()
                })
                .await?;
            let m_small = MediaSearchItem {
                identifier: m.id.to_string(),
                lot: m.lot,
                title: m.title,
                poster_images,
                publish_year: m.publish_year,
            };
            items.push(m_small);
        }
        Ok(MediaSearchResults {
            total: total.try_into().unwrap(),
            items,
        })
    }

    pub async fn progress_update(&self, input: ProgressUpdate, user_id: i32) -> Result<IdObject> {
        let meta = Seen::find()
            .filter(seen::Column::Identifier.eq(input.identifier.clone()))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject {
                id: m.metadata_id.into(),
            })
        } else {
            let prev_seen = Seen::find()
                .filter(seen::Column::Progress.lt(100))
                .filter(seen::Column::UserId.eq(user_id))
                .filter(seen::Column::MetadataId.eq(i32::from(input.metadata_id)))
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
                    let meta = Metadata::find_by_id(input.metadata_id)
                        .one(&self.db)
                        .await
                        .unwrap()
                        .unwrap();
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
                    let mut seen_ins = seen::ActiveModel {
                        progress: ActiveValue::Set(progress),
                        user_id: ActiveValue::Set(user_id),
                        metadata_id: ActiveValue::Set(i32::from(input.metadata_id)),
                        started_on: ActiveValue::Set(started_on),
                        finished_on: ActiveValue::Set(finished_on),
                        last_updated_on: ActiveValue::Set(Utc::now()),
                        identifier: ActiveValue::Set(input.identifier),
                        ..Default::default()
                    };
                    if meta.lot == MetadataLot::Show {
                        seen_ins.extra_information = ActiveValue::Set(Some(
                            SeenExtraInformation::Show(SeenShowExtraInformation {
                                season: input.show_season_number.unwrap(),
                                episode: input.show_episode_number.unwrap(),
                            }),
                        ));
                    } else if meta.lot == MetadataLot::Podcast {
                        seen_ins.extra_information = ActiveValue::Set(Some(
                            SeenExtraInformation::Podcast(SeenPodcastExtraInformation {
                                episode: input.podcast_episode_number.unwrap(),
                            }),
                        ))
                    }

                    seen_ins.insert(&self.db).await.unwrap()
                }
            };
            let id = seen_item.id.into();
            let metadata = self.generic_metadata(input.metadata_id.into()).await?;
            let mut storage = self.after_media_seen.clone();
            storage
                .push(AfterMediaSeenJob {
                    seen: seen_item,
                    metadata_lot: metadata.model.lot,
                })
                .await
                .ok();
            Ok(IdObject { id })
        }
    }

    pub async fn deploy_recalculate_summary_job(&self, user_id: i32) -> Result<()> {
        let mut storage = self.recalculate_user_summary.clone();
        storage
            .push(RecalculateUserSummaryJob {
                user_id: user_id.into(),
            })
            .await?;
        Ok(())
    }

    pub async fn cleanup_user_and_metadata_association(&self) -> Result<()> {
        let user_to_metadatas = UserToMetadata::find().all(&self.db).await.unwrap();
        for u in user_to_metadatas {
            // check if there is any seen item
            let seen_count = Seen::find()
                .filter(seen::Column::UserId.eq(u.user_id))
                .filter(seen::Column::MetadataId.eq(u.metadata_id))
                .count(&self.db)
                .await
                .unwrap();
            // check if it has been reviewed
            let reviewed_count = Review::find()
                .filter(review::Column::UserId.eq(u.user_id))
                .filter(review::Column::MetadataId.eq(u.metadata_id))
                .count(&self.db)
                .await
                .unwrap();
            // check if it is part of any collection
            let collection_ids: Vec<i32> = Collection::find()
                .select_only()
                .column(collection::Column::Id)
                .filter(collection::Column::UserId.eq(u.user_id))
                .into_tuple()
                .all(&self.db)
                .await
                .unwrap();
            let meta_ids: Vec<i32> = MetadataToCollection::find()
                .select_only()
                .column(metadata_to_collection::Column::MetadataId)
                .filter(metadata_to_collection::Column::CollectionId.is_in(collection_ids))
                .into_tuple()
                .all(&self.db)
                .await
                .unwrap();
            let is_in_collection = meta_ids.contains(&u.metadata_id);
            if seen_count + reviewed_count == 0 && !is_in_collection {
                tracing::debug!(
                    "Removing user_to_metadata = {id:?}",
                    id = (u.user_id, u.metadata_id)
                );
                u.delete(&self.db).await.ok();
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_media(
        &self,
        metadata_id: i32,
        title: String,
        description: Option<String>,
        poster_images: Vec<String>,
        backdrop_images: Vec<String>,
        creators: Vec<MetadataCreator>,
    ) -> Result<()> {
        let mut images = vec![];
        for image in poster_images.into_iter() {
            images.push(MetadataImage {
                url: image,
                lot: MetadataImageLot::Poster,
            });
        }
        for image in backdrop_images.into_iter() {
            images.push(MetadataImage {
                url: image,
                lot: MetadataImageLot::Backdrop,
            });
        }
        let meta = Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let mut meta: metadata::ActiveModel = meta.into();
        meta.title = ActiveValue::Set(title);
        meta.description = ActiveValue::Set(description);
        meta.images = ActiveValue::Set(MetadataImages(images));
        meta.last_updated_on = ActiveValue::Set(Utc::now());
        meta.creators = ActiveValue::Set(MetadataCreators(creators));
        meta.save(&self.db).await.ok();
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn commit_media(
        &self,
        identifier: String,
        lot: MetadataLot,
        title: String,
        description: Option<String>,
        publish_year: Option<i32>,
        publish_date: Option<NaiveDate>,
        poster_images: Vec<String>,
        backdrop_images: Vec<String>,
        creators: Vec<MetadataCreator>,
        genres: Vec<String>,
    ) -> Result<i32> {
        let mut images = vec![];
        for image in poster_images.into_iter() {
            images.push(MetadataImage {
                url: image,
                lot: MetadataImageLot::Poster,
            });
        }
        for image in backdrop_images.into_iter() {
            images.push(MetadataImage {
                url: image,
                lot: MetadataImageLot::Backdrop,
            });
        }
        let metadata = metadata::ActiveModel {
            lot: ActiveValue::Set(lot),
            title: ActiveValue::Set(title),
            description: ActiveValue::Set(description),
            publish_year: ActiveValue::Set(publish_year),
            publish_date: ActiveValue::Set(publish_date),
            images: ActiveValue::Set(MetadataImages(images)),
            identifier: ActiveValue::Set(identifier),
            creators: ActiveValue::Set(MetadataCreators(creators)),
            ..Default::default()
        };
        let metadata = metadata.insert(&self.db).await.unwrap();
        for genre in genres {
            let db_genre = if let Some(c) = Genre::find()
                .filter(genre::Column::Name.eq(&genre))
                .one(&self.db)
                .await
                .unwrap()
            {
                c
            } else {
                let c = genre::ActiveModel {
                    name: ActiveValue::Set(genre),
                    ..Default::default()
                };
                c.insert(&self.db).await.unwrap()
            };
            let intermediate = metadata_to_genre::ActiveModel {
                metadata_id: ActiveValue::Set(metadata.id),
                genre_id: ActiveValue::Set(db_genre.id),
            };
            intermediate.insert(&self.db).await.ok();
        }
        Ok(metadata.id)
    }

    pub async fn cleanup_metadata_with_associated_user_activities(&self) -> Result<()> {
        let all_metadata = Metadata::find().all(&self.db).await.unwrap();
        for metadata in all_metadata {
            let num_associations = UserToMetadata::find()
                .filter(user_to_metadata::Column::MetadataId.eq(metadata.id))
                .count(&self.db)
                .await
                .unwrap();
            if num_associations == 0 {
                metadata.delete(&self.db).await.ok();
            }
        }
        Ok(())
    }

    pub async fn deploy_update_metadata_job(&self, metadata_id: i32) -> Result<String> {
        let metadata = Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let mut storage = self.update_metadata.clone();
        let job_id = storage.push(UpdateMetadataJob { metadata }).await?;
        Ok(job_id.to_string())
    }
}
