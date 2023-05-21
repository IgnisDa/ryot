use std::{collections::HashSet, sync::Arc};

use apalis::{prelude::Storage, sqlite::SqliteStorage};
use argon2::{
    password_hash::{PasswordHash, PasswordVerifier},
    Argon2,
};
use async_graphql::{Context, Enum, InputObject, Object, Result, SimpleObject, Union};
use chrono::Utc;
use cookie::{
    time::{ext::NumericalDuration, OffsetDateTime},
    Cookie,
};
use http::header::SET_COOKIE;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait,
    PaginatorTrait, QueryFilter, QueryOrder,
};
use uuid::Uuid;

use crate::{
    background::UserCreatedJob,
    config::AppConfig,
    entities::{
        prelude::{AudioBook, Book, Metadata, Movie, Podcast, Seen, Show, Summary, Token, User},
        seen, summary, token, user,
        user::Model as UserModel,
        utils::SeenExtraInformation,
    },
    graphql::IdObject,
    migrator::{MetadataLot, TokenLot, UserLot},
    misc::{resolver::MiscService, DefaultCollection},
    utils::{user_auth_token_from_ctx, user_id_from_ctx, NamedObject},
};

pub static COOKIE_NAME: &str = "auth";

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum UserDetailsErrorVariant {
    AuthTokenInvalid,
}

#[derive(Debug, SimpleObject)]
pub struct UserDetailsError {
    error: UserDetailsErrorVariant,
}

#[derive(Union)]
pub enum UserDetailsResult {
    Ok(UserModel),
    Error(UserDetailsError),
}

#[derive(Debug, InputObject)]
struct UserInput {
    username: String,
    #[graphql(secret)]
    password: String,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
enum RegisterErrorVariant {
    UsernameAlreadyExists,
}

#[derive(Debug, SimpleObject)]
struct RegisterError {
    error: RegisterErrorVariant,
}

#[derive(Union)]
enum RegisterResult {
    Ok(IdObject),
    Error(RegisterError),
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
enum LoginErrorVariant {
    UsernameDoesNotExist,
    CredentialsMismatch,
}

#[derive(Debug, SimpleObject)]
struct LoginError {
    error: LoginErrorVariant,
}

#[derive(Debug, SimpleObject)]
struct LoginResponse {
    api_key: Uuid,
}

#[derive(Union)]
enum LoginResult {
    Ok(LoginResponse),
    Error(LoginError),
}

#[derive(Debug, InputObject)]
struct UpdateUserInput {
    username: Option<String>,
    email: Option<String>,
    #[graphql(secret)]
    password: Option<String>,
}

fn create_cookie(
    ctx: &Context<'_>,
    api_key: &str,
    expires: bool,
    insecure_cookie: bool,
) -> Result<()> {
    let mut cookie = Cookie::build(COOKIE_NAME, api_key.to_string()).secure(!insecure_cookie);
    if expires {
        cookie = cookie.expires(OffsetDateTime::now_utc());
    } else {
        cookie = cookie.expires(OffsetDateTime::now_utc().checked_add(90.days()));
    }
    let cookie = cookie.finish();
    ctx.insert_http_header(SET_COOKIE, cookie.to_string());
    Ok(())
}

fn get_hasher() -> Argon2<'static> {
    Argon2::default()
}

#[derive(SimpleObject, Debug)]
pub struct AudioBooksSummary {
    runtime: i32,
    played: i32,
}

#[derive(SimpleObject, Debug)]
pub struct VideoGamesSummary {
    played: i32,
}

#[derive(SimpleObject, Debug)]
pub struct BooksSummary {
    pages: i32,
    read: i32,
}

#[derive(SimpleObject, Debug)]
pub struct MoviesSummary {
    runtime: i32,
    watched: i32,
}

#[derive(SimpleObject, Debug)]
pub struct PodcastsSummary {
    runtime: i32,
    played: i32,
    played_episodes: i32,
}

#[derive(SimpleObject, Debug)]
pub struct ShowsSummary {
    runtime: i32,
    watched_shows: i32,
    watched_episodes: i32,
    watched_seasons: i32,
}

#[derive(SimpleObject, Debug)]
pub struct UserSummary {
    books: BooksSummary,
    movies: MoviesSummary,
    podcasts: PodcastsSummary,
    shows: ShowsSummary,
    video_games: VideoGamesSummary,
    audio_books: AudioBooksSummary,
}

#[derive(Default)]
pub struct UsersQuery;

#[Object]
impl UsersQuery {
    /// Get details about the currently logged in user.
    pub async fn user_details(&self, gql_ctx: &Context<'_>) -> Result<UserDetailsResult> {
        let token = user_auth_token_from_ctx(gql_ctx)?;
        gql_ctx
            .data_unchecked::<UsersService>()
            .user_details(&token)
            .await
    }

    /// Get a summary of all the media items that have been consumed by this user.
    pub async fn user_summary(&self, gql_ctx: &Context<'_>) -> Result<UserSummary> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<UsersService>()
            .user_summary(&user_id)
            .await
    }
}

#[derive(Default)]
pub struct UsersMutation;

#[Object]
impl UsersMutation {
    /// Create a new user for the service. Also set their `lot` as admin if
    /// they are the first user.
    async fn register_user(
        &self,
        gql_ctx: &Context<'_>,
        input: UserInput,
    ) -> Result<RegisterResult> {
        gql_ctx
            .data_unchecked::<UsersService>()
            .register_user(&input.username, &input.password)
            .await
    }

    /// Login a user using their username and password and return an API key.
    async fn login_user(&self, gql_ctx: &Context<'_>, input: UserInput) -> Result<LoginResult> {
        let api_key = gql_ctx
            .data_unchecked::<UsersService>()
            .login_user(&input.username, &input.password)
            .await?;
        let cookie_insecure = gql_ctx.data_unchecked::<AppConfig>().web.insecure_cookie;
        if let LoginResult::Ok(LoginResponse { api_key }) = api_key {
            create_cookie(gql_ctx, &api_key.to_string(), false, cookie_insecure)?;
        };
        Ok(api_key)
    }

    /// Logout a user from the server, deleting their login token.
    async fn logout_user(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let cookie_insecure = gql_ctx.data_unchecked::<AppConfig>().web.insecure_cookie;
        create_cookie(gql_ctx, "", true, cookie_insecure)?;
        let user_id = user_auth_token_from_ctx(gql_ctx)?;
        gql_ctx
            .data_unchecked::<UsersService>()
            .logout_user(&user_id)
            .await
    }

    /// Delete all summaries for the currently logged in user and then generate one from scratch.
    pub async fn regenerate_user_summary(&self, gql_ctx: &Context<'_>) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        let service = gql_ctx.data_unchecked::<UsersService>();
        service.cleanup_summaries_for_user(&user_id, None).await?;
        service.regenerate_user_summary(&user_id).await
    }

    /// Update a user's profile details.
    async fn update_user(&self, gql_ctx: &Context<'_>, input: UpdateUserInput) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<UsersService>()
            .update_user(&user_id, input)
            .await
    }
}

#[derive(Debug, Clone)]
pub struct UsersService {
    db: DatabaseConnection,
    misc_service: Arc<MiscService>,
    user_created: SqliteStorage<UserCreatedJob>,
}

impl UsersService {
    pub fn new(
        db: &DatabaseConnection,
        misc_service: &MiscService,
        user_created: &SqliteStorage<UserCreatedJob>,
    ) -> Self {
        Self {
            db: db.clone(),
            misc_service: Arc::new(misc_service.clone()),
            user_created: user_created.clone(),
        }
    }
}

impl UsersService {
    async fn user_details(&self, token: &str) -> Result<UserDetailsResult> {
        let token = Token::find()
            .filter(token::Column::Value.eq(token))
            .one(&self.db)
            .await?;
        if let Some(t) = token {
            let user = t.find_related(User).one(&self.db).await.unwrap().unwrap();
            Ok(UserDetailsResult::Ok(user))
        } else {
            Ok(UserDetailsResult::Error(UserDetailsError {
                error: UserDetailsErrorVariant::AuthTokenInvalid,
            }))
        }
    }

    async fn latest_user_summary(&self, user_id: &i32) -> Result<summary::Model> {
        let ls = Summary::find()
            .filter(summary::Column::UserId.eq(user_id.to_owned()))
            .order_by_desc(summary::Column::CreatedOn)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap_or_default();
        Ok(ls)
    }

    async fn user_summary(&self, user_id: &i32) -> Result<UserSummary> {
        let ls = self.latest_user_summary(user_id).await?;
        Ok(UserSummary {
            books: BooksSummary {
                pages: ls.books_pages,
                read: ls.books_read,
            },
            movies: MoviesSummary {
                runtime: ls.movies_runtime,
                watched: ls.movies_watched,
            },
            podcasts: PodcastsSummary {
                runtime: ls.podcasts_runtime,
                played: ls.podcasts_played,
                played_episodes: ls.podcast_episodes_played,
            },
            shows: ShowsSummary {
                runtime: ls.shows_runtime,
                watched_shows: ls.shows_watched,
                watched_episodes: ls.shows_episodes_watched,
                watched_seasons: ls.shows_seasons_watched,
            },
            video_games: VideoGamesSummary {
                played: ls.video_games_played,
            },
            audio_books: AudioBooksSummary {
                runtime: ls.audio_books_runtime,
                played: ls.audio_books_played,
            },
        })
    }

    pub async fn regenerate_user_summary(&self, user_id: &i32) -> Result<IdObject> {
        let ls = self.latest_user_summary(user_id).await?;
        let seen_items = Seen::find()
            .filter(seen::Column::LastUpdatedOn.gte(ls.created_on))
            .filter(seen::Column::UserId.eq(user_id.to_owned()))
            .filter(seen::Column::UserId.eq(user_id.to_owned()))
            .filter(seen::Column::Progress.eq(100))
            .find_also_related(Metadata)
            .all(&self.db)
            .await
            .unwrap();
        let mut audio_books_total = ls.audio_books_played;
        let mut audio_books_runtime = ls.audio_books_runtime;
        let mut books_total = ls.books_read;
        let mut books_pages = ls.books_pages;
        let mut movies_total = ls.movies_watched;
        let mut movies_runtime = ls.movies_runtime;
        let mut podcasts_runtime = ls.podcasts_runtime;
        let mut shows_runtime = ls.shows_runtime;
        let mut show_episodes_total = ls.shows_episodes_watched;
        let mut video_games_total = ls.video_games_played;

        let mut unique_shows = HashSet::new();
        let mut unique_show_seasons = HashSet::new();
        let mut unique_podcasts = HashSet::new();
        let mut unique_podcast_episodes = HashSet::new();
        for (seen, metadata) in seen_items.iter() {
            let meta = metadata.to_owned().unwrap();
            match meta.lot {
                MetadataLot::AudioBook => {
                    let item = meta
                        .find_related(AudioBook)
                        .one(&self.db)
                        .await
                        .unwrap()
                        .unwrap();
                    audio_books_total += 1;
                    if let Some(r) = item.runtime {
                        audio_books_runtime += r;
                    }
                }
                MetadataLot::Book => {
                    let item = meta
                        .find_related(Book)
                        .one(&self.db)
                        .await
                        .unwrap()
                        .unwrap();
                    books_total += 1;
                    if let Some(pg) = item.num_pages {
                        books_pages += pg;
                    }
                }
                MetadataLot::Podcast => {
                    let item = meta
                        .find_related(Podcast)
                        .one(&self.db)
                        .await
                        .unwrap()
                        .unwrap();
                    unique_podcasts.insert(seen.metadata_id);
                    for episode in item.details.episodes {
                        match seen.extra_information.to_owned() {
                            None => continue,
                            Some(sei) => match sei {
                                SeenExtraInformation::Show(_) => unreachable!(),
                                SeenExtraInformation::Podcast(s) => {
                                    if s.episode == episode.number {
                                        if let Some(r) = episode.runtime {
                                            podcasts_runtime += r;
                                        }
                                        unique_podcast_episodes.insert(s.episode);
                                    }
                                }
                            },
                        }
                    }
                }
                MetadataLot::Movie => {
                    let item = meta
                        .find_related(Movie)
                        .one(&self.db)
                        .await
                        .unwrap()
                        .unwrap();
                    movies_total += 1;
                    if let Some(r) = item.runtime {
                        movies_runtime += r;
                    }
                }
                MetadataLot::Show => {
                    let item = meta
                        .find_related(Show)
                        .one(&self.db)
                        .await
                        .unwrap()
                        .unwrap();
                    unique_shows.insert(seen.metadata_id);
                    for season in item.details.seasons {
                        for episode in season.episodes {
                            match seen.extra_information.to_owned().unwrap() {
                                SeenExtraInformation::Podcast(_) => unreachable!(),
                                SeenExtraInformation::Show(s) => {
                                    if s.season == season.season_number
                                        && s.episode == episode.episode_number
                                    {
                                        if let Some(r) = episode.runtime {
                                            shows_runtime += r;
                                        }
                                        show_episodes_total += 1;
                                        unique_show_seasons.insert(s.season);
                                    }
                                }
                            }
                        }
                    }
                }
                MetadataLot::VideoGame => {
                    video_games_total += 1;
                }
            }
        }
        let summary_obj = summary::ActiveModel {
            id: ActiveValue::NotSet,
            created_on: ActiveValue::NotSet,
            user_id: ActiveValue::Set(user_id.to_owned()),
            audio_books_runtime: ActiveValue::Set(audio_books_runtime.try_into().unwrap()),
            audio_books_played: ActiveValue::Set(audio_books_total.try_into().unwrap()),
            books_pages: ActiveValue::Set(books_pages.try_into().unwrap()),
            books_read: ActiveValue::Set(books_total.try_into().unwrap()),
            movies_runtime: ActiveValue::Set(movies_runtime.try_into().unwrap()),
            movies_watched: ActiveValue::Set(movies_total.try_into().unwrap()),
            shows_runtime: ActiveValue::Set(shows_runtime.try_into().unwrap()),
            shows_watched: ActiveValue::Set(
                ls.shows_watched + i32::try_from(unique_shows.len()).unwrap(),
            ),
            shows_episodes_watched: ActiveValue::Set(show_episodes_total.try_into().unwrap()),
            shows_seasons_watched: ActiveValue::Set(
                ls.shows_seasons_watched + i32::try_from(unique_show_seasons.len()).unwrap(),
            ),
            video_games_played: ActiveValue::Set(video_games_total.try_into().unwrap()),
            podcasts_runtime: ActiveValue::Set(podcasts_runtime.try_into().unwrap()),
            podcasts_played: ActiveValue::Set(
                ls.podcasts_played + i32::try_from(unique_podcasts.len()).unwrap(),
            ),
            podcast_episodes_played: ActiveValue::Set(
                ls.podcast_episodes_played + i32::try_from(unique_podcast_episodes.len()).unwrap(),
            ),
        };
        let obj = summary_obj.insert(&self.db).await.unwrap();
        Ok(IdObject { id: obj.id.into() })
    }

    async fn register_user(&self, username: &str, password: &str) -> Result<RegisterResult> {
        let mut storage = self.user_created.clone();
        if User::find()
            .filter(user::Column::Name.eq(username))
            .count(&self.db)
            .await
            .unwrap()
            != 0
        {
            return Ok(RegisterResult::Error(RegisterError {
                error: RegisterErrorVariant::UsernameAlreadyExists,
            }));
        };
        let lot = if User::find().count(&self.db).await.unwrap() == 0 {
            UserLot::Admin
        } else {
            UserLot::Normal
        };
        let user = user::ActiveModel {
            name: ActiveValue::Set(username.to_owned()),
            password: ActiveValue::Set(password.to_owned()),
            lot: ActiveValue::Set(lot),
            ..Default::default()
        };
        let user = user.insert(&self.db).await.unwrap();
        storage
            .push(UserCreatedJob {
                user_id: user.id.clone().into(),
            })
            .await?;
        Ok(RegisterResult::Ok(IdObject { id: user.id.into() }))
    }

    async fn login_user(&self, username: &str, password: &str) -> Result<LoginResult> {
        let user = User::find()
            .filter(user::Column::Name.eq(username))
            .one(&self.db)
            .await
            .unwrap();
        if user.is_none() {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::UsernameDoesNotExist,
            }));
        };
        let user = user.unwrap();
        let parsed_hash = PasswordHash::new(&user.password).unwrap();
        if get_hasher()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_err()
        {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::CredentialsMismatch,
            }));
        }
        let api_key = Uuid::new_v4();

        let token = token::ActiveModel {
            value: ActiveValue::Set(api_key.to_string()),
            lot: ActiveValue::Set(TokenLot::Login),
            user_id: ActiveValue::Set(user.id),
            last_used: ActiveValue::Set(Some(Utc::now())),
            ..Default::default()
        };
        token.insert(&self.db).await.unwrap();
        Ok(LoginResult::Ok(LoginResponse { api_key }))
    }

    async fn logout_user(&self, token: &str) -> Result<bool> {
        let token = Token::find()
            .filter(token::Column::Value.eq(token))
            .one(&self.db)
            .await?;
        if let Some(t) = token {
            t.delete(&self.db).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    // this job is run when a user is created for the first time
    pub async fn user_created_job(&self, user_id: &i32) -> Result<()> {
        self.misc_service
            .create_collection(
                user_id,
                NamedObject {
                    name: DefaultCollection::Watchlist.to_string(),
                },
            )
            .await?;
        self.misc_service
            .create_collection(
                user_id,
                NamedObject {
                    name: DefaultCollection::Abandoned.to_string(),
                },
            )
            .await?;
        self.misc_service
            .create_collection(
                user_id,
                NamedObject {
                    name: DefaultCollection::InProgress.to_string(),
                },
            )
            .await?;
        Ok(())
    }

    async fn update_user(&self, user_id: &i32, input: UpdateUserInput) -> Result<IdObject> {
        let mut user_obj: user::ActiveModel = User::find_by_id(user_id.to_owned())
            .one(&self.db)
            .await
            .unwrap()
            .unwrap()
            .into();
        if let Some(n) = input.username {
            user_obj.name = ActiveValue::Set(n);
        }
        if let Some(e) = input.email {
            user_obj.email = ActiveValue::Set(Some(e));
        }
        if let Some(p) = input.password {
            user_obj.password = ActiveValue::Set(p);
        }
        let user_obj = user_obj.update(&self.db).await.unwrap();
        Ok(IdObject {
            id: user_obj.id.into(),
        })
    }

    pub async fn cleanup_summaries_for_user(
        &self,
        user_id: &i32,
        skip: Option<usize>,
    ) -> Result<()> {
        let summaries = Summary::find()
            .filter(summary::Column::UserId.eq(user_id.to_owned()))
            .order_by_desc(summary::Column::CreatedOn)
            .all(&self.db)
            .await
            .unwrap();
        for summary in summaries.into_iter().skip(skip.unwrap_or_default()) {
            summary.delete(&self.db).await.ok();
        }
        Ok(())
    }

    pub async fn cleanup_user_summaries(&self) -> Result<()> {
        let all_users = User::find().all(&self.db).await.unwrap();
        for user in all_users {
            self.cleanup_summaries_for_user(&user.id, Some(1)).await?;
        }
        Ok(())
    }
}
