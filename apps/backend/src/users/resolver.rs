use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use async_graphql::{Context, Enum, InputObject, Object, Result, SimpleObject, Union};
use chrono::Utc;
use cookie::{time::OffsetDateTime, Cookie};
use http::header::SET_COOKIE;
use sea_orm::{
    ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait, PaginatorTrait,
    QueryFilter,
};
use uuid::Uuid;

use crate::{
    entities::{
        book, movie,
        prelude::{Book, Metadata, Movie, Seen, Show, Token, User, VideoGame},
        seen::{self, SeenExtraInformation},
        show, token, user,
        user::Model as UserModel,
        video_game,
    },
    graphql::IdObject,
    migrator::{MetadataLot, TokenLot, UserLot},
    utils::{user_auth_token_from_ctx, user_id_from_ctx},
};

pub static COOKIE_NAME: &str = "auth";

fn create_cookie(ctx: &Context<'_>, api_key: &str, expires: bool) -> Result<()> {
    let mut cookie = Cookie::build(COOKIE_NAME, api_key.to_string()).secure(true);
    if expires {
        cookie = cookie.expires(OffsetDateTime::now_utc());
    }
    let cookie = cookie.finish();
    ctx.insert_http_header(SET_COOKIE, cookie.to_string());
    Ok(())
}

fn get_hasher() -> Argon2<'static> {
    Argon2::default()
}

#[derive(SimpleObject)]
pub struct VideoGamesSummary {
    played: u64,
}

#[derive(SimpleObject)]
pub struct BooksSummary {
    pages: i32,
    read: u64,
}

#[derive(SimpleObject)]
pub struct MoviesSummary {
    runtime: i32,
    watched: u64,
}

#[derive(SimpleObject)]
pub struct ShowsSummary {
    runtime: i32,
    watched: u64,
}

#[derive(SimpleObject)]
pub struct UserSummary {
    books: BooksSummary,
    movies: MoviesSummary,
    shows: ShowsSummary,
    video_games: VideoGamesSummary,
}

#[derive(Default)]
pub struct UsersQuery;

#[Object]
impl UsersQuery {
    /// Get details about the currently logged in user
    pub async fn user_details(&self, gql_ctx: &Context<'_>) -> Result<UserDetailsResult> {
        let token = user_auth_token_from_ctx(gql_ctx)?;
        gql_ctx
            .data_unchecked::<UsersService>()
            .user_details(&token)
            .await
    }

    /// Get a summary of all the media items that have beem consumed by this user
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
        if let LoginResult::Ok(LoginResponse { api_key }) = api_key {
            create_cookie(gql_ctx, &api_key.to_string(), false)?;
        };
        Ok(api_key)
    }

    /// Logout a user from the server, deleting their login token
    async fn logout_user(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        create_cookie(gql_ctx, "", true)?;
        let user_id = user_auth_token_from_ctx(gql_ctx)?;
        gql_ctx
            .data_unchecked::<UsersService>()
            .logout_user(&user_id)
            .await
    }
}

#[derive(Debug)]
pub struct UsersService {
    db: DatabaseConnection,
}

impl UsersService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
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

    async fn user_summary(&self, user_id: &i32) -> Result<UserSummary> {
        let seen_items = Seen::find()
            .filter(seen::Column::UserId.eq(user_id.to_owned()))
            .filter(seen::Column::Progress.eq(100))
            .find_also_related(Metadata)
            .all(&self.db)
            .await
            .unwrap();
        let mut books_total = vec![];
        let mut movies_total = vec![];
        let mut shows_total = vec![];
        for (seen, metadata) in seen_items.iter() {
            let meta = metadata.to_owned().unwrap();
            match meta.lot {
                MetadataLot::Book => {
                    let item = meta
                        .find_related(Book)
                        .one(&self.db)
                        .await
                        .unwrap()
                        .unwrap();
                    if let Some(pg) = item.num_pages {
                        books_total.push(pg);
                    }
                }
                MetadataLot::Movie => {
                    let item = meta
                        .find_related(Movie)
                        .one(&self.db)
                        .await
                        .unwrap()
                        .unwrap();
                    if let Some(r) = item.runtime {
                        movies_total.push(r);
                    }
                }
                MetadataLot::Show => {
                    let item = meta
                        .find_related(Show)
                        .one(&self.db)
                        .await
                        .unwrap()
                        .unwrap();
                    for season in item.details.seasons {
                        for episode in season.episodes {
                            match seen.extra_information.to_owned().unwrap() {
                                SeenExtraInformation::Show(s) => {
                                    if s.season == season.season_number
                                        && s.episode == episode.episode_number
                                    {
                                        if let Some(r) = episode.runtime {
                                            shows_total.push(r);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                _ => continue,
            }
        }
        let metadata_ids = seen_items
            .iter()
            .map(|s| s.0.metadata_id)
            .collect::<Vec<_>>();
        let books_count = Book::find()
            .filter(book::Column::MetadataId.is_in(metadata_ids.clone()))
            .count(&self.db)
            .await
            .unwrap();
        let movies_count = Movie::find()
            .filter(movie::Column::MetadataId.is_in(metadata_ids.clone()))
            .count(&self.db)
            .await
            .unwrap();
        let shows_count = Show::find()
            .filter(show::Column::MetadataId.is_in(metadata_ids.clone()))
            .count(&self.db)
            .await
            .unwrap();
        let video_games_count = VideoGame::find()
            .filter(video_game::Column::MetadataId.is_in(metadata_ids.clone()))
            .count(&self.db)
            .await
            .unwrap();
        Ok(UserSummary {
            books: BooksSummary {
                pages: books_total.iter().sum(),
                read: books_count,
            },
            movies: MoviesSummary {
                runtime: movies_total.iter().sum(),
                watched: movies_count,
            },
            shows: ShowsSummary {
                runtime: shows_total.iter().sum(),
                watched: shows_count,
            },
            video_games: VideoGamesSummary {
                played: video_games_count,
            },
        })
    }

    async fn register_user(&self, username: &str, password: &str) -> Result<RegisterResult> {
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
        let salt = SaltString::generate(&mut OsRng);
        let password_hash = get_hasher()
            .hash_password(password.as_bytes(), &salt)?
            .to_string();
        let lot = if User::find().count(&self.db).await.unwrap() == 0 {
            UserLot::Admin
        } else {
            UserLot::Normal
        };
        let user = user::ActiveModel {
            name: ActiveValue::Set(username.to_owned()),
            password: ActiveValue::Set(password_hash.to_owned()),
            lot: ActiveValue::Set(lot),
            ..Default::default()
        };
        let user = User::insert(user).exec(&self.db).await.unwrap();
        Ok(RegisterResult::Ok(IdObject {
            id: user.last_insert_id,
        }))
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
        Token::insert(token).exec(&self.db).await.unwrap();

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
}

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
