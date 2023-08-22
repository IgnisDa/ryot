use std::{str::FromStr, sync::Arc};

use apalis::{prelude::Storage as ApalisStorage, sqlite::SqliteStorage};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use async_graphql::{Context, Enum, Error, InputObject, Object, Result, SimpleObject, Union};
use chrono::Utc;
use cookie::{time::Duration as CookieDuration, time::OffsetDateTime, Cookie, SameSite};
use harsh::Harsh;
use http::header::SET_COOKIE;
use itertools::Itertools;

use nanoid::nanoid;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection,
    EntityTrait, ModelTrait, PaginatorTrait, QueryFilter, QueryOrder,
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    background::ApplicationJob,
    config::AppConfig,
    entities::{prelude::User, user},
    migrator::UserLot,
    models::{IdObject, UserSummary},
    traits::{AuthProvider, IsFeatureEnabled},
    users::{
        UserDistanceUnit, UserNotification, UserNotificationSetting, UserNotificationSettingKind,
        UserNotifications, UserPreferences, UserSinkIntegration, UserSinkIntegrationSetting,
        UserSinkIntegrationSettingKind, UserSinkIntegrations, UserWeightUnit, UserYankIntegration,
        UserYankIntegrationSetting, UserYankIntegrationSettingKind, UserYankIntegrations,
    },
    utils::{user_id_from_token, MemoryAuthData, MemoryDatabase, COOKIE_NAME},
};

#[derive(Enum, Serialize, Deserialize, Clone, Debug, Copy, PartialEq, Eq)]
enum UserIntegrationLot {
    Yank,
    Sink,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct GraphqlUserIntegration {
    id: usize,
    description: String,
    timestamp: DateTimeUtc,
    lot: UserIntegrationLot,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct CreateUserYankIntegrationInput {
    lot: UserYankIntegrationSettingKind,
    base_url: String,
    #[graphql(secret)]
    token: String,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct GraphqlUserNotificationPlatform {
    id: usize,
    description: String,
    timestamp: DateTimeUtc,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct CreateUserNotificationPlatformInput {
    lot: UserNotificationSettingKind,
    base_url: Option<String>,
    #[graphql(secret)]
    api_token: Option<String>,
    priority: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct CreateUserSinkIntegrationInput {
    lot: UserSinkIntegrationSettingKind,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
enum CreateCustomMediaErrorVariant {
    LotDoesNotMatchSpecifics,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
enum UserDetailsErrorVariant {
    AuthTokenInvalid,
}

#[derive(Debug, SimpleObject)]
struct UserDetailsError {
    error: UserDetailsErrorVariant,
}

#[derive(Union)]
enum UserDetailsResult {
    Ok(Box<user::Model>),
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
    Disabled,
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
    MutexError,
}

#[derive(Debug, SimpleObject)]
struct LoginError {
    error: LoginErrorVariant,
}

#[derive(Debug, SimpleObject)]
struct LoginResponse {
    api_key: String,
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

#[derive(Debug, InputObject)]
struct UpdateUserPreferenceInput {
    property: String,
    value: String,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct UserAuthToken {
    token: String,
    last_used_on: DateTimeUtc,
}

fn create_cookie(
    ctx: &Context<'_>,
    api_key: &str,
    expires: bool,
    insecure_cookie: bool,
    samesite_none: bool,
    token_valid_till: i64,
) -> Result<()> {
    let mut cookie = Cookie::build(COOKIE_NAME, api_key.to_string()).secure(!insecure_cookie);
    cookie = if expires {
        cookie.expires(OffsetDateTime::now_utc())
    } else {
        cookie
            .expires(OffsetDateTime::now_utc().checked_add(CookieDuration::days(token_valid_till)))
    };
    cookie = if samesite_none {
        cookie.same_site(SameSite::None)
    } else {
        cookie.same_site(SameSite::Strict)
    };
    let cookie = cookie.finish();
    ctx.insert_http_header(SET_COOKIE, cookie.to_string());
    Ok(())
}

fn get_password_hasher() -> Argon2<'static> {
    Argon2::default()
}

fn get_id_hasher(salt: &str) -> Harsh {
    Harsh::builder().length(10).salt(salt).build().unwrap()
}

#[derive(Default)]
pub struct UsersQuery;

#[Object]
impl UsersQuery {
    /// Get a user's preferences.
    async fn user_preferences(&self, gql_ctx: &Context<'_>) -> Result<UserPreferences> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_preferences(user_id).await
    }

    /// Get details about all the users in the service.
    async fn users_list(&self, gql_ctx: &Context<'_>) -> Result<Vec<user::Model>> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.admin_account_guard(user_id).await?;
        service.users_list().await
    }

    /// Get details about the currently logged in user.
    async fn user_details(&self, gql_ctx: &Context<'_>) -> Result<UserDetailsResult> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let token = service.user_auth_token_from_ctx(gql_ctx)?;
        service.user_details(&token).await
    }

    /// Get a summary of all the media items that have been consumed by this user.
    async fn latest_user_summary(&self, gql_ctx: &Context<'_>) -> Result<UserSummary> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.latest_user_summary(user_id).await
    }

    /// Get all the integrations for the currently logged in user.
    async fn user_integrations(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<Vec<GraphqlUserIntegration>> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_integrations(user_id).await
    }

    /// Get all the notification platforms for the currently logged in user.
    async fn user_notification_platforms(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<Vec<GraphqlUserNotificationPlatform>> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_notification_platforms(user_id).await
    }

    /// Get all the auth tokens issued to the currently logged in user.
    async fn user_auth_tokens(&self, gql_ctx: &Context<'_>) -> Result<Vec<UserAuthToken>> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_auth_tokens(user_id).await
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
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        service
            .register_user(&input.username, &input.password)
            .await
    }

    /// Login a user using their username and password and return an auth token.
    async fn login_user(&self, gql_ctx: &Context<'_>, input: UserInput) -> Result<LoginResult> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        service
            .login_user(&input.username, &input.password, gql_ctx)
            .await
    }

    /// Logout a user from the server and delete their login token.
    async fn logout_user(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_auth_token_from_ctx(gql_ctx)?;
        service.logout_user(&user_id, gql_ctx).await
    }

    /// Update a user's profile details.
    async fn update_user(&self, gql_ctx: &Context<'_>, input: UpdateUserInput) -> Result<IdObject> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.update_user(user_id, input).await
    }

    /// Delete all summaries for the currently logged in user and then generate one from scratch.
    pub async fn regenerate_user_summary(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.deploy_recalculate_summary_job(user_id).await.ok();
        Ok(true)
    }

    /// Change a user's preferences.
    async fn update_user_preference(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserPreferenceInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.update_user_preference(input, user_id).await
    }

    /// Generate an auth token without any expiry.
    async fn generate_application_token(&self, gql_ctx: &Context<'_>) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.generate_application_token(user_id).await
    }

    /// Create a sink based integrations for the currently logged in user.
    async fn create_user_sink_integration(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateUserSinkIntegrationInput,
    ) -> Result<usize> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.create_user_sink_integration(user_id, input).await
    }

    /// Create a yank based integrations for the currently logged in user.
    async fn create_user_yank_integration(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateUserYankIntegrationInput,
    ) -> Result<usize> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.create_user_yank_integration(user_id, input).await
    }

    /// Delete an integration for the currently logged in user.
    async fn delete_user_integration(
        &self,
        gql_ctx: &Context<'_>,
        integration_id: usize,
        integration_lot: UserIntegrationLot,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .delete_user_integration(user_id, integration_id, integration_lot)
            .await
    }

    /// Add a notification platform for the currently logged in user.
    async fn create_user_notification_platform(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateUserNotificationPlatformInput,
    ) -> Result<usize> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .create_user_notification_platform(user_id, input)
            .await
    }

    /// Test all notification platforms for the currently logged in user.
    async fn test_user_notification_platforms(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .send_notifications_to_user_platforms(user_id, "Test notification message triggered.")
            .await
    }

    /// Delete a notification platform for the currently logged in user.
    async fn delete_user_notification_platform(
        &self,
        gql_ctx: &Context<'_>,
        notification_id: usize,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .delete_user_notification_platform(user_id, notification_id)
            .await
    }

    /// Delete an auth token for the currently logged in user.
    async fn delete_user_auth_token(&self, gql_ctx: &Context<'_>, token: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.delete_user_auth_token(user_id, token).await
    }

    /// Delete a user. The account making the user must an `Admin`.
    async fn delete_user(&self, gql_ctx: &Context<'_>, to_delete_user_id: i32) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<UsersService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.admin_account_guard(user_id).await?;
        service.delete_user(to_delete_user_id).await
    }
}

pub struct UsersService {
    pub db: DatabaseConnection,
    pub auth_db: MemoryDatabase,
    pub perform_application_job: SqliteStorage<ApplicationJob>,
    config: Arc<AppConfig>,
}

impl AuthProvider for UsersService {
    fn get_auth_db(&self) -> &MemoryDatabase {
        &self.auth_db
    }
}

impl UsersService {
    pub fn new(
        db: &DatabaseConnection,
        config: Arc<AppConfig>,
        auth_db: MemoryDatabase,
        perform_application_job: &SqliteStorage<ApplicationJob>,
    ) -> Self {
        Self {
            db: db.clone(),
            auth_db,
            config,
            perform_application_job: perform_application_job.clone(),
        }
    }
}

impl UsersService {
    pub async fn deploy_recalculate_summary_job(&self, user_id: i32) -> Result<()> {
        self.perform_application_job
            .clone()
            .push(ApplicationJob::RecalculateUserSummary(user_id))
            .await?;
        Ok(())
    }

    pub async fn user_preferences(&self, user_id: i32) -> Result<UserPreferences> {
        let mut prefs = self.user_by_id(user_id).await?.preferences;
        prefs.features_enabled.media.anime =
            self.config.anime.is_enabled() && prefs.features_enabled.media.anime;
        prefs.features_enabled.media.audio_book =
            self.config.audio_books.is_enabled() && prefs.features_enabled.media.audio_book;
        prefs.features_enabled.media.book =
            self.config.books.is_enabled() && prefs.features_enabled.media.book;
        prefs.features_enabled.media.show =
            self.config.shows.is_enabled() && prefs.features_enabled.media.show;
        prefs.features_enabled.media.manga =
            self.config.manga.is_enabled() && prefs.features_enabled.media.manga;
        prefs.features_enabled.media.movie =
            self.config.movies.is_enabled() && prefs.features_enabled.media.movie;
        prefs.features_enabled.media.podcast =
            self.config.podcasts.is_enabled() && prefs.features_enabled.media.podcast;
        prefs.features_enabled.media.video_game =
            self.config.video_games.is_enabled() && prefs.features_enabled.media.video_game;
        Ok(prefs)
    }

    async fn user_details(&self, token: &str) -> Result<UserDetailsResult> {
        let found_token = user_id_from_token(token.to_owned(), self.get_auth_db()).await;
        if let Ok(user_id) = found_token {
            let user = self.user_by_id(user_id).await?;
            Ok(UserDetailsResult::Ok(Box::new(user)))
        } else {
            Ok(UserDetailsResult::Error(UserDetailsError {
                error: UserDetailsErrorVariant::AuthTokenInvalid,
            }))
        }
    }

    async fn user_by_id(&self, user_id: i32) -> Result<user::Model> {
        User::find_by_id(user_id)
            .one(&self.db)
            .await
            .unwrap()
            .ok_or_else(|| Error::new("No user found"))
    }

    async fn latest_user_summary(&self, user_id: i32) -> Result<UserSummary> {
        let ls = self.user_by_id(user_id).await?;
        Ok(ls.summary.unwrap_or_default())
    }

    async fn register_user(&self, username: &str, password: &str) -> Result<RegisterResult> {
        if !self.config.users.allow_registration {
            return Ok(RegisterResult::Error(RegisterError {
                error: RegisterErrorVariant::Disabled,
            }));
        }
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
            preferences: ActiveValue::Set(UserPreferences::default()),
            sink_integrations: ActiveValue::Set(UserSinkIntegrations(vec![])),
            notifications: ActiveValue::Set(UserNotifications(vec![])),
            ..Default::default()
        };
        let user = user.insert(&self.db).await.unwrap();
        self.perform_application_job
            .clone()
            .push(ApplicationJob::UserCreated(user.id))
            .await?;
        Ok(RegisterResult::Ok(IdObject { id: user.id }))
    }

    async fn login_user(
        &self,
        username: &str,
        password: &str,
        gql_ctx: &Context<'_>,
    ) -> Result<LoginResult> {
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
        if get_password_hasher()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_err()
        {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::CredentialsMismatch,
            }));
        }
        let api_key = Uuid::new_v4().to_string();

        if self.set_auth_token(&api_key, user.id).await.is_err() {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::MutexError,
            }));
        };
        create_cookie(
            gql_ctx,
            &api_key,
            false,
            self.config.server.insecure_cookie,
            self.config.server.samesite_none,
            self.config.users.token_valid_for_days,
        )?;
        Ok(LoginResult::Ok(LoginResponse { api_key }))
    }

    async fn logout_user(&self, token: &str, gql_ctx: &Context<'_>) -> Result<bool> {
        create_cookie(
            gql_ctx,
            "",
            true,
            self.config.server.insecure_cookie,
            self.config.server.samesite_none,
            self.config.users.token_valid_for_days,
        )?;
        let found_token = user_id_from_token(token.to_owned(), self.get_auth_db()).await;
        if found_token.is_ok() {
            self.get_auth_db().remove(token.to_owned()).await.unwrap();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    async fn update_user(&self, user_id: i32, input: UpdateUserInput) -> Result<IdObject> {
        let mut user_obj: user::ActiveModel = User::find_by_id(user_id.to_owned())
            .one(&self.db)
            .await
            .unwrap()
            .unwrap()
            .into();
        if let Some(n) = input.username {
            if self.config.users.allow_changing_username {
                user_obj.name = ActiveValue::Set(n);
            }
        }
        if let Some(e) = input.email {
            user_obj.email = ActiveValue::Set(Some(e));
        }
        if let Some(p) = input.password {
            if self.config.users.allow_changing_password {
                user_obj.password = ActiveValue::Set(p);
            }
        }
        let user_obj = user_obj.update(&self.db).await.unwrap();
        Ok(IdObject { id: user_obj.id })
    }

    async fn update_user_preference(
        &self,
        input: UpdateUserPreferenceInput,
        user_id: i32,
    ) -> Result<bool> {
        if !self.config.users.allow_changing_preferences {
            return Ok(false);
        }
        let err = || Error::new("Incorrect property value encountered");
        let user_model = self.user_by_id(user_id).await?;
        let mut preferences = user_model.preferences.clone();
        let (left, right) = input.property.split_once('.').ok_or_else(err)?;
        let value_bool = input.value.parse::<bool>();
        let value_usize = input.value.parse::<usize>();
        match left {
            "fitness" => {
                let (left, right) = right.split_once('.').ok_or_else(err)?;
                match left {
                    "measurements" => {
                        let (left, right) = right.split_once('.').ok_or_else(err)?;
                        match left {
                            "custom" => {
                                let value_vector = serde_json::from_str(&input.value).unwrap();
                                preferences.fitness.measurements.custom = value_vector;
                            }
                            "inbuilt" => match right {
                                "weight" => {
                                    preferences.fitness.measurements.inbuilt.weight =
                                        value_bool.unwrap();
                                }
                                "body_mass_index" => {
                                    preferences.fitness.measurements.inbuilt.body_mass_index =
                                        value_bool.unwrap();
                                }
                                "total_body_water" => {
                                    preferences.fitness.measurements.inbuilt.total_body_water =
                                        value_bool.unwrap();
                                }
                                "muscle" => {
                                    preferences.fitness.measurements.inbuilt.muscle =
                                        value_bool.unwrap();
                                }
                                "lean_body_mass" => {
                                    preferences.fitness.measurements.inbuilt.lean_body_mass =
                                        value_bool.unwrap();
                                }
                                "body_fat" => {
                                    preferences.fitness.measurements.inbuilt.body_fat =
                                        value_bool.unwrap();
                                }
                                "bone_mass" => {
                                    preferences.fitness.measurements.inbuilt.bone_mass =
                                        value_bool.unwrap();
                                }
                                "visceral_fat" => {
                                    preferences.fitness.measurements.inbuilt.visceral_fat =
                                        value_bool.unwrap();
                                }
                                "waist_circumference" => {
                                    preferences.fitness.measurements.inbuilt.waist_circumference =
                                        value_bool.unwrap();
                                }
                                "waist_to_height_ratio" => {
                                    preferences
                                        .fitness
                                        .measurements
                                        .inbuilt
                                        .waist_to_height_ratio = value_bool.unwrap();
                                }
                                "hip_circumference" => {
                                    preferences.fitness.measurements.inbuilt.hip_circumference =
                                        value_bool.unwrap();
                                }
                                "waist_to_hip_ratio" => {
                                    preferences.fitness.measurements.inbuilt.waist_to_hip_ratio =
                                        value_bool.unwrap();
                                }
                                "chest_circumference" => {
                                    preferences.fitness.measurements.inbuilt.chest_circumference =
                                        value_bool.unwrap();
                                }
                                "thigh_circumference" => {
                                    preferences.fitness.measurements.inbuilt.thigh_circumference =
                                        value_bool.unwrap();
                                }
                                "biceps_circumference" => {
                                    preferences
                                        .fitness
                                        .measurements
                                        .inbuilt
                                        .biceps_circumference = value_bool.unwrap();
                                }
                                "neck_circumference" => {
                                    preferences.fitness.measurements.inbuilt.neck_circumference =
                                        value_bool.unwrap();
                                }
                                "body_fat_caliper" => {
                                    preferences.fitness.measurements.inbuilt.body_fat_caliper =
                                        value_bool.unwrap();
                                }
                                "chest_skinfold" => {
                                    preferences.fitness.measurements.inbuilt.chest_skinfold =
                                        value_bool.unwrap();
                                }
                                "abdominal_skinfold" => {
                                    preferences.fitness.measurements.inbuilt.abdominal_skinfold =
                                        value_bool.unwrap();
                                }
                                "thigh_skinfold" => {
                                    preferences.fitness.measurements.inbuilt.thigh_skinfold =
                                        value_bool.unwrap();
                                }
                                "basal_metabolic_rate" => {
                                    preferences
                                        .fitness
                                        .measurements
                                        .inbuilt
                                        .basal_metabolic_rate = value_bool.unwrap();
                                }
                                "total_daily_energy_expenditure" => {
                                    preferences
                                        .fitness
                                        .measurements
                                        .inbuilt
                                        .total_daily_energy_expenditure = value_bool.unwrap();
                                }
                                "calories" => {
                                    preferences.fitness.measurements.inbuilt.calories =
                                        value_bool.unwrap();
                                }
                                _ => return Err(err()),
                            },
                            _ => return Err(err()),
                        }
                    }
                    "exercises" => match right {
                        "save_history" => {
                            preferences.fitness.exercises.save_history = value_usize.unwrap()
                        }
                        "distance_unit" => {
                            preferences.fitness.exercises.distance_unit =
                                UserDistanceUnit::from_str(&input.value).unwrap();
                        }
                        "weight_unit" => {
                            preferences.fitness.exercises.weight_unit =
                                UserWeightUnit::from_str(&input.value).unwrap();
                        }
                        _ => return Err(err()),
                    },
                    _ => return Err(err()),
                }
            }
            "features_enabled" => {
                let (left, right) = right.split_once('.').ok_or_else(err)?;
                match left {
                    "fitness" => match right {
                        "enabled" => {
                            preferences.features_enabled.fitness.enabled = value_bool.unwrap()
                        }
                        _ => return Err(err()),
                    },
                    "media" => {
                        match right {
                            "enabled" => {
                                preferences.features_enabled.media.enabled = value_bool.unwrap()
                            }
                            "audio_book" => {
                                preferences.features_enabled.media.audio_book = value_bool.unwrap()
                            }
                            "book" => preferences.features_enabled.media.book = value_bool.unwrap(),
                            "movie" => {
                                preferences.features_enabled.media.movie = value_bool.unwrap()
                            }
                            "podcast" => {
                                preferences.features_enabled.media.podcast = value_bool.unwrap()
                            }
                            "show" => preferences.features_enabled.media.show = value_bool.unwrap(),
                            "video_game" => {
                                preferences.features_enabled.media.video_game = value_bool.unwrap()
                            }
                            "manga" => {
                                preferences.features_enabled.media.manga = value_bool.unwrap()
                            }
                            "anime" => {
                                preferences.features_enabled.media.anime = value_bool.unwrap()
                            }
                            _ => return Err(err()),
                        };
                    }
                    _ => return Err(err()),
                }
            }
            "notifications" => match right {
                "episode_released" => {
                    preferences.notifications.episode_released = value_bool.unwrap()
                }
                "status_changed" => preferences.notifications.status_changed = value_bool.unwrap(),
                "release_date_changed" => {
                    preferences.notifications.release_date_changed = value_bool.unwrap()
                }
                "number_of_seasons_changed" => {
                    preferences.notifications.number_of_seasons_changed = value_bool.unwrap()
                }
                _ => return Err(err()),
            },
            _ => return Err(err()),
        };
        let mut user_model: user::ActiveModel = user_model.into();
        user_model.preferences = ActiveValue::Set(preferences);
        user_model.update(&self.db).await?;
        Ok(true)
    }

    async fn generate_application_token(&self, user_id: i32) -> Result<String> {
        let api_token = nanoid!(10);
        self.set_auth_token(&api_token, user_id)
            .await
            .map_err(|_| Error::new("Could not set auth token"))?;
        Ok(api_token)
    }

    async fn user_integrations(&self, user_id: i32) -> Result<Vec<GraphqlUserIntegration>> {
        let user = self.user_by_id(user_id).await?;
        let mut all_integrations = vec![];
        let yank_integrations = if let Some(i) = user.yank_integrations {
            i.0
        } else {
            vec![]
        };
        yank_integrations.into_iter().for_each(|i| {
            let description = match i.settings {
                UserYankIntegrationSetting::Audiobookshelf { base_url, .. } => {
                    format!("Audiobookshelf URL: {}", base_url)
                }
            };
            all_integrations.push(GraphqlUserIntegration {
                id: i.id,
                lot: UserIntegrationLot::Yank,
                description,
                timestamp: i.timestamp,
            })
        });
        let sink_integrations = user.sink_integrations.0;
        sink_integrations.into_iter().for_each(|i| {
            let description = match i.settings {
                UserSinkIntegrationSetting::Jellyfin { slug } => {
                    format!("Jellyfin slug: {}", slug)
                }
            };
            all_integrations.push(GraphqlUserIntegration {
                id: i.id,
                lot: UserIntegrationLot::Sink,
                description,
                timestamp: i.timestamp,
            })
        });
        Ok(all_integrations)
    }

    async fn user_notification_platforms(
        &self,
        user_id: i32,
    ) -> Result<Vec<GraphqlUserNotificationPlatform>> {
        let user = self.user_by_id(user_id).await?;
        let mut all_notifications = vec![];
        let notifications = user.notifications.0;
        notifications.into_iter().for_each(|n| {
            let description = match n.settings {
                UserNotificationSetting::Apprise { url, key } => {
                    format!("Apprise URL: {}, Key: {}", url, key)
                }
                UserNotificationSetting::Discord { url } => {
                    format!("Discord webhook: {}", url)
                }
                UserNotificationSetting::Gotify { url, token, .. } => {
                    format!("Gotify URL: {}, Token: {}", url, token)
                }
                UserNotificationSetting::Ntfy { url, topic, .. } => {
                    format!("Ntfy URL: {:?}, Topic: {}", url, topic)
                }
                UserNotificationSetting::PushBullet { api_token } => {
                    format!("Pushbullet API Token: {}", api_token)
                }
                UserNotificationSetting::PushOver { key, app_key } => {
                    format!("PushOver Key: {}, App Key: {:?}", key, app_key)
                }
                UserNotificationSetting::PushSafer { key } => {
                    format!("PushSafer Key: {}", key)
                }
            };
            all_notifications.push(GraphqlUserNotificationPlatform {
                id: n.id,
                description,
                timestamp: n.timestamp,
            })
        });
        Ok(all_notifications)
    }

    async fn create_user_sink_integration(
        &self,
        user_id: i32,
        input: CreateUserSinkIntegrationInput,
    ) -> Result<usize> {
        let user = self.user_by_id(user_id).await?;
        let mut integrations = user.sink_integrations.clone().0;
        let new_integration_id = integrations.len() + 1;
        let new_integration = UserSinkIntegration {
            id: new_integration_id,
            timestamp: Utc::now(),
            settings: match input.lot {
                UserSinkIntegrationSettingKind::Jellyfin => {
                    let slug = get_id_hasher(&self.config.integration.hasher_salt)
                        .encode(&[user_id.try_into().unwrap()]);
                    let slug = format!("{}--{}", slug, nanoid!(5));
                    UserSinkIntegrationSetting::Jellyfin { slug }
                }
            },
        };
        integrations.insert(0, new_integration);
        let mut user: user::ActiveModel = user.into();
        user.sink_integrations = ActiveValue::Set(UserSinkIntegrations(integrations));
        user.update(&self.db).await?;
        Ok(new_integration_id)
    }

    async fn create_user_yank_integration(
        &self,
        user_id: i32,
        input: CreateUserYankIntegrationInput,
    ) -> Result<usize> {
        let user = self.user_by_id(user_id).await?;
        let mut integrations = if let Some(i) = user.yank_integrations.clone() {
            i.0
        } else {
            vec![]
        };
        let new_integration_id = integrations.len() + 1;
        let new_integration = UserYankIntegration {
            id: new_integration_id,
            timestamp: Utc::now(),
            settings: match input.lot {
                UserYankIntegrationSettingKind::Audiobookshelf => {
                    UserYankIntegrationSetting::Audiobookshelf {
                        base_url: input.base_url,
                        token: input.token,
                    }
                }
            },
        };
        integrations.insert(0, new_integration);
        let mut user: user::ActiveModel = user.into();
        user.yank_integrations = ActiveValue::Set(Some(UserYankIntegrations(integrations)));
        user.update(&self.db).await?;
        Ok(new_integration_id)
    }

    async fn delete_user_integration(
        &self,
        user_id: i32,
        integration_id: usize,
        integration_type: UserIntegrationLot,
    ) -> Result<bool> {
        let user = self.user_by_id(user_id).await?;
        let mut user_db: user::ActiveModel = user.clone().into();
        match integration_type {
            UserIntegrationLot::Yank => {
                let integrations = if let Some(i) = user.yank_integrations.clone() {
                    i.0
                } else {
                    vec![]
                };
                let remaining_integrations = integrations
                    .into_iter()
                    .filter(|i| i.id != integration_id)
                    .collect_vec();
                let update_value = if remaining_integrations.is_empty() {
                    None
                } else {
                    Some(UserYankIntegrations(remaining_integrations))
                };
                user_db.yank_integrations = ActiveValue::Set(update_value);
            }
            UserIntegrationLot::Sink => {
                let integrations = user.sink_integrations.clone().0;
                let remaining_integrations = integrations
                    .into_iter()
                    .filter(|i| i.id != integration_id)
                    .collect_vec();
                let update_value = UserSinkIntegrations(remaining_integrations);
                user_db.sink_integrations = ActiveValue::Set(update_value);
            }
        };
        user_db.update(&self.db).await?;
        Ok(true)
    }

    async fn create_user_notification_platform(
        &self,
        user_id: i32,
        input: CreateUserNotificationPlatformInput,
    ) -> Result<usize> {
        let user = self.user_by_id(user_id).await?;
        let mut notifications = user.notifications.clone().0;
        let new_notification_id = notifications.len() + 1;
        let new_notification = UserNotification {
            id: new_notification_id,
            timestamp: Utc::now(),
            settings: match input.lot {
                UserNotificationSettingKind::Apprise => UserNotificationSetting::Apprise {
                    url: input.base_url.unwrap(),
                    key: input.api_token.unwrap(),
                },
                UserNotificationSettingKind::Discord => UserNotificationSetting::Discord {
                    url: input.base_url.unwrap(),
                },
                UserNotificationSettingKind::Gotify => UserNotificationSetting::Gotify {
                    url: input.base_url.unwrap(),
                    token: input.api_token.unwrap(),
                    priority: input.priority,
                },
                UserNotificationSettingKind::Ntfy => UserNotificationSetting::Ntfy {
                    url: input.base_url,
                    topic: input.api_token.unwrap(),
                    priority: input.priority,
                },
                UserNotificationSettingKind::PushBullet => UserNotificationSetting::PushBullet {
                    api_token: input.api_token.unwrap(),
                },
                UserNotificationSettingKind::PushOver => UserNotificationSetting::PushOver {
                    key: input.api_token.unwrap(),
                    app_key: input.base_url,
                },
                UserNotificationSettingKind::PushSafer => UserNotificationSetting::PushSafer {
                    key: input.api_token.unwrap(),
                },
            },
        };

        notifications.insert(0, new_notification);
        let mut user: user::ActiveModel = user.into();
        user.notifications = ActiveValue::Set(UserNotifications(notifications));
        user.update(&self.db).await?;
        Ok(new_notification_id)
    }

    async fn delete_user_notification_platform(
        &self,
        user_id: i32,
        notification_id: usize,
    ) -> Result<bool> {
        let user = self.user_by_id(user_id).await?;
        let mut user_db: user::ActiveModel = user.clone().into();
        let notifications = user.notifications.clone().0;
        let remaining_notifications = notifications
            .into_iter()
            .filter(|i| i.id != notification_id)
            .collect_vec();
        let update_value = UserNotifications(remaining_notifications);
        user_db.notifications = ActiveValue::Set(update_value);
        user_db.update(&self.db).await?;
        Ok(true)
    }

    async fn set_auth_token(&self, api_key: &str, user_id: i32) -> anyhow::Result<()> {
        self.get_auth_db()
            .insert(
                api_key.to_owned(),
                MemoryAuthData {
                    user_id: user_id.to_owned(),
                    last_used_on: Utc::now(),
                },
            )
            .await
            .unwrap();
        Ok(())
    }

    async fn all_user_auth_tokens(&self, user_id: i32) -> Result<Vec<UserAuthToken>> {
        let tokens = self
            .get_auth_db()
            .iter()
            .filter_map(|r| {
                if r.user_id == user_id {
                    Some(UserAuthToken {
                        token: r.key().clone(),
                        last_used_on: r.last_used_on,
                    })
                } else {
                    None
                }
            })
            .collect_vec();
        let tokens = tokens
            .into_iter()
            .sorted_unstable_by_key(|t| t.last_used_on)
            .rev()
            .collect();
        Ok(tokens)
    }

    async fn user_auth_tokens(&self, user_id: i32) -> Result<Vec<UserAuthToken>> {
        let mut tokens = self.all_user_auth_tokens(user_id).await?;
        tokens.iter_mut().for_each(|t| {
            // taken from https://users.rust-lang.org/t/take-last-n-characters-from-string/44638/4
            t.token.drain(0..t.token.len() - 6);
        });
        Ok(tokens)
    }

    async fn delete_user_auth_token(&self, user_id: i32, token: String) -> Result<bool> {
        let tokens = self.all_user_auth_tokens(user_id).await?;
        let resp = if let Some(t) = tokens.into_iter().find(|t| t.token.ends_with(&token)) {
            self.get_auth_db().remove(t.token).await.unwrap();
            true
        } else {
            false
        };
        Ok(resp)
    }

    async fn admin_account_guard(&self, user_id: i32) -> Result<()> {
        let main_user = self.user_by_id(user_id).await?;
        if main_user.lot != UserLot::Admin {
            return Err(Error::new("Only admins can perform this operation."));
        }
        Ok(())
    }

    async fn users_list(&self) -> Result<Vec<user::Model>> {
        Ok(User::find()
            .order_by_asc(user::Column::Id)
            .all(&self.db)
            .await?)
    }

    async fn delete_user(&self, to_delete_user_id: i32) -> Result<bool> {
        let maybe_user = User::find_by_id(to_delete_user_id).one(&self.db).await?;
        if let Some(u) = maybe_user {
            if self
                .users_list()
                .await?
                .into_iter()
                .filter(|u| u.lot == UserLot::Admin)
                .collect_vec()
                .len()
                == 1
                && u.lot == UserLot::Admin
            {
                return Ok(false);
            }
            u.delete(&self.db).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub async fn send_notifications_to_user_platforms(
        &self,
        user_id: i32,
        msg: &str,
    ) -> Result<bool> {
        let user = self.user_by_id(user_id).await?;
        let mut success = true;
        for notification in user.notifications.0 {
            if notification.settings.send_message(msg).await.is_err() {
                success = false;
            }
        }
        Ok(success)
    }
}
