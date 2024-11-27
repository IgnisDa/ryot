use std::{str::FromStr, sync::Arc};

use application_utils::user_id_from_token;
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use async_graphql::{Error, Result};
use chrono::{Timelike, Utc};
use common_models::{DefaultCollection, StringIdObject, UpdateComplexJsonInput};
use common_utils::ryot_log;
use database_models::{
    access_link, integration, metadata, notification_platform,
    prelude::{AccessLink, Integration, Metadata, NotificationPlatform, User},
    user,
};
use database_utils::{
    admin_account_guard, create_or_update_collection,
    deploy_job_to_calculate_user_activities_and_summary, ilike_sql, pro_instance_guard,
    revoke_access_link, user_by_id,
};
use dependent_models::UserDetailsResult;
use enum_meta::Meta;
use enums::{IntegrationLot, IntegrationProvider, NotificationPlatformLot, UserLot};
use fitness_models::UserUnitSystem;
use itertools::Itertools;
use jwt_service::{sign, AccessLinkClaims};
use media_models::{
    AuthUserInput, CreateAccessLinkInput, CreateOrUpdateCollectionInput,
    CreateUserIntegrationInput, CreateUserNotificationPlatformInput, LoginError, LoginErrorVariant,
    LoginResponse, LoginResult, OidcTokenOutput, PasswordUserInput, ProcessAccessLinkError,
    ProcessAccessLinkErrorVariant, ProcessAccessLinkInput, ProcessAccessLinkResponse,
    ProcessAccessLinkResult, RegisterError, RegisterErrorVariant, RegisterResult,
    RegisterUserInput, UpdateUserInput, UpdateUserIntegrationInput,
    UpdateUserNotificationPlatformInput, UserDetailsError, UserDetailsErrorVariant,
};
use nanoid::nanoid;
use notification_service::send_notification;
use openidconnect::{
    core::CoreResponseType, reqwest::async_http_client, AuthenticationFlow, AuthorizationCode,
    CsrfToken, Nonce, Scope, TokenResponse,
};
use sea_orm::{
    prelude::Expr,
    sea_query::{extension::postgres::PgExpr, Func},
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, Iterable, ModelTrait, Order,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};
use supporting_service::SupportingService;
use user_models::{
    DashboardElementLot, GridPacking, NotificationPlatformSpecifics, UserPreferences,
    UserReviewScale,
};

fn empty_nonce_verifier(_nonce: Option<&Nonce>) -> Result<(), String> {
    Ok(())
}

pub struct UserService(pub Arc<SupportingService>);

impl UserService {
    pub async fn user_recommendations(&self, user_id: &String) -> Result<Vec<String>> {
        let preferences = user_by_id(user_id, &self.0).await?.preferences;
        let limit = preferences
            .general
            .dashboard
            .into_iter()
            .find(|d| d.section == DashboardElementLot::Recommendations)
            .unwrap()
            .num_elements;
        let current_hour = Utc::now().hour();
        let recs = Metadata::find()
            .filter(metadata::Column::IsRecommendation.eq(true))
            .order_by(
                Expr::expr(Func::md5(
                    Expr::col(metadata::Column::Title)
                        .concat(Expr::val(user_id))
                        .concat(Expr::val(current_hour)),
                )),
                Order::Desc,
            )
            .limit(limit)
            .all(&self.0.db)
            .await?
            .into_iter()
            .map(|r| r.id)
            .collect_vec();
        Ok(recs)
    }

    pub async fn user_access_links(&self, user_id: &String) -> Result<Vec<access_link::Model>> {
        let links = AccessLink::find()
            .filter(access_link::Column::UserId.eq(user_id))
            .order_by_desc(access_link::Column::CreatedOn)
            .all(&self.0.db)
            .await?;
        Ok(links)
    }

    pub async fn create_access_link(
        &self,
        input: CreateAccessLinkInput,
        user_id: String,
    ) -> Result<StringIdObject> {
        pro_instance_guard(self.0.is_pro).await?;
        let new_link = access_link::ActiveModel {
            user_id: ActiveValue::Set(user_id),
            name: ActiveValue::Set(input.name),
            expires_on: ActiveValue::Set(input.expires_on),
            redirect_to: ActiveValue::Set(input.redirect_to),
            maximum_uses: ActiveValue::Set(input.maximum_uses),
            is_account_default: ActiveValue::Set(input.is_account_default),
            is_mutation_allowed: ActiveValue::Set(input.is_mutation_allowed),
            ..Default::default()
        };
        let link = new_link.insert(&self.0.db).await?;
        Ok(StringIdObject { id: link.id })
    }

    pub async fn process_access_link(
        &self,
        input: ProcessAccessLinkInput,
    ) -> Result<ProcessAccessLinkResult> {
        let maybe_link = match input {
            ProcessAccessLinkInput::Id(id) => AccessLink::find_by_id(id).one(&self.0.db).await?,
            ProcessAccessLinkInput::Username(username) => {
                let user = User::find()
                    .filter(user::Column::Name.eq(username))
                    .one(&self.0.db)
                    .await?;
                match user {
                    None => None,
                    Some(u) => {
                        u.find_related(AccessLink)
                            .filter(access_link::Column::IsAccountDefault.eq(true))
                            .filter(access_link::Column::IsRevoked.is_null())
                            .one(&self.0.db)
                            .await?
                    }
                }
            }
        };
        let link = match maybe_link {
            None => {
                return Ok(ProcessAccessLinkResult::Error(ProcessAccessLinkError {
                    error: ProcessAccessLinkErrorVariant::NotFound,
                }))
            }
            Some(l) => l,
        };
        if let Some(expiration_time) = link.expires_on {
            if expiration_time < Utc::now() {
                return Ok(ProcessAccessLinkResult::Error(ProcessAccessLinkError {
                    error: ProcessAccessLinkErrorVariant::Expired,
                }));
            }
        }
        if let Some(max_uses) = link.maximum_uses {
            if link.times_used >= max_uses {
                return Ok(ProcessAccessLinkResult::Error(ProcessAccessLinkError {
                    error: ProcessAccessLinkErrorVariant::MaximumUsesReached,
                }));
            }
        }
        if let Some(true) = link.is_revoked {
            return Ok(ProcessAccessLinkResult::Error(ProcessAccessLinkError {
                error: ProcessAccessLinkErrorVariant::Revoked,
            }));
        }
        let validity = if let Some(expires) = link.expires_on {
            (expires - Utc::now()).num_days().try_into().unwrap()
        } else {
            self.0.config.users.token_valid_for_days
        };
        let api_key = sign(
            link.user_id.clone(),
            &self.0.config.users.jwt_secret,
            validity,
            Some(AccessLinkClaims {
                id: link.id.clone(),
                is_demo: link.is_demo,
            }),
        )?;
        let mut issued_tokens = link.issued_tokens.clone();
        issued_tokens.push(api_key.clone());
        let mut link: access_link::ActiveModel = link.into();
        link.issued_tokens = ActiveValue::Set(issued_tokens);
        let link = link.update(&self.0.db).await?;
        Ok(ProcessAccessLinkResult::Ok(ProcessAccessLinkResponse {
            api_key,
            token_valid_for_days: validity,
            redirect_to: link.redirect_to,
        }))
    }

    pub async fn revoke_access_link(&self, access_link_id: String) -> Result<bool> {
        pro_instance_guard(self.0.is_pro).await?;
        revoke_access_link(&self.0.db, access_link_id).await
    }

    pub async fn users_list(&self, query: Option<String>) -> Result<Vec<user::Model>> {
        let users = User::find()
            .apply_if(query, |query, value| {
                query.filter(
                    Expr::col(user::Column::Name)
                        .ilike(ilike_sql(&value))
                        .or(Expr::col(user::Column::Id).ilike(ilike_sql(&value))),
                )
            })
            .order_by_asc(user::Column::Name)
            .all(&self.0.db)
            .await?;
        Ok(users)
    }

    pub async fn delete_user(
        &self,
        admin_user_id: String,
        to_delete_user_id: String,
    ) -> Result<bool> {
        admin_account_guard(&admin_user_id, &self.0).await?;
        let maybe_user = User::find_by_id(to_delete_user_id).one(&self.0.db).await?;
        let Some(u) = maybe_user else {
            return Ok(false);
        };
        if self
            .users_list(None)
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
        u.delete(&self.0.db).await?;
        Ok(true)
    }

    pub async fn register_user(&self, input: RegisterUserInput) -> Result<RegisterResult> {
        if !self.0.config.users.allow_registration
            && input.admin_access_token.unwrap_or_default()
                != self.0.config.server.admin_access_token
        {
            return Ok(RegisterResult::Error(RegisterError {
                error: RegisterErrorVariant::Disabled,
            }));
        }
        let (filter, username, password) = match input.data.clone() {
            AuthUserInput::Oidc(data) => (
                user::Column::OidcIssuerId.eq(&data.issuer_id),
                data.email,
                None,
            ),
            AuthUserInput::Password(data) => (
                user::Column::Name.eq(&data.username),
                data.username,
                Some(data.password),
            ),
        };
        if User::find().filter(filter).count(&self.0.db).await.unwrap() != 0 {
            return Ok(RegisterResult::Error(RegisterError {
                error: RegisterErrorVariant::IdentifierAlreadyExists,
            }));
        };
        let oidc_issuer_id = match input.data {
            AuthUserInput::Oidc(data) => Some(data.issuer_id),
            AuthUserInput::Password(_) => None,
        };
        let lot = if User::find().count(&self.0.db).await.unwrap() == 0 {
            UserLot::Admin
        } else {
            UserLot::Normal
        };
        let user = user::ActiveModel {
            id: ActiveValue::Set(format!("usr_{}", nanoid!(12))),
            name: ActiveValue::Set(username),
            password: ActiveValue::Set(password),
            oidc_issuer_id: ActiveValue::Set(oidc_issuer_id),
            lot: ActiveValue::Set(lot),
            preferences: ActiveValue::Set(UserPreferences::default()),
            ..Default::default()
        };
        let user = user.insert(&self.0.db).await.unwrap();
        ryot_log!(
            debug,
            "User {:?} registered with id {:?}",
            user.name,
            user.id
        );
        for col in DefaultCollection::iter() {
            let meta = col.meta().to_owned();
            create_or_update_collection(
                &self.0.db,
                &user.id,
                CreateOrUpdateCollectionInput {
                    name: col.to_string(),
                    description: Some(meta.1.to_owned()),
                    information_template: meta.0,
                    ..Default::default()
                },
            )
            .await
            .ok();
        }
        deploy_job_to_calculate_user_activities_and_summary(&user.id, false, &self.0).await;
        Ok(RegisterResult::Ok(StringIdObject { id: user.id }))
    }

    pub async fn generate_auth_token(&self, user_id: String) -> Result<String> {
        let auth_token = sign(
            user_id,
            &self.0.config.users.jwt_secret,
            self.0.config.users.token_valid_for_days,
            None,
        )?;
        Ok(auth_token)
    }

    pub async fn login_user(&self, input: AuthUserInput) -> Result<LoginResult> {
        let filter = match input.clone() {
            AuthUserInput::Oidc(input) => user::Column::OidcIssuerId.eq(input.issuer_id),
            AuthUserInput::Password(input) => user::Column::Name.eq(input.username),
        };
        let Some(user) = User::find().filter(filter).one(&self.0.db).await? else {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::UsernameDoesNotExist,
            }));
        };
        if user.is_disabled.unwrap_or_default() {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::AccountDisabled,
            }));
        }
        if self.0.config.users.validate_password {
            if let AuthUserInput::Password(PasswordUserInput { password, .. }) = input {
                if let Some(hashed_password) = &user.password {
                    let parsed_hash = PasswordHash::new(hashed_password).unwrap();
                    if Argon2::default()
                        .verify_password(password.as_bytes(), &parsed_hash)
                        .is_err()
                    {
                        return Ok(LoginResult::Error(LoginError {
                            error: LoginErrorVariant::CredentialsMismatch,
                        }));
                    }
                } else {
                    return Ok(LoginResult::Error(LoginError {
                        error: LoginErrorVariant::IncorrectProviderChosen,
                    }));
                }
            }
        }
        let jwt_key = self.generate_auth_token(user.id.clone()).await?;
        let mut user: user::ActiveModel = user.into();
        user.last_login_on = ActiveValue::Set(Some(Utc::now()));
        user.update(&self.0.db).await?;
        Ok(LoginResult::Ok(LoginResponse { api_key: jwt_key }))
    }

    pub async fn update_user(
        &self,
        user_id: Option<String>,
        input: UpdateUserInput,
    ) -> Result<StringIdObject> {
        if user_id.unwrap_or_default() != input.user_id
            && input.admin_access_token.unwrap_or_default()
                != self.0.config.server.admin_access_token
        {
            return Err(Error::new("Admin access token mismatch".to_owned()));
        }
        let mut user_obj: user::ActiveModel = User::find_by_id(input.user_id)
            .one(&self.0.db)
            .await
            .unwrap()
            .unwrap()
            .into();
        if let Some(n) = input.username {
            user_obj.name = ActiveValue::Set(n);
        }
        if let Some(p) = input.password {
            user_obj.password = ActiveValue::Set(Some(p));
        }
        if let Some(i) = input.extra_information {
            user_obj.extra_information = ActiveValue::Set(Some(i));
        }
        if let Some(l) = input.lot {
            user_obj.lot = ActiveValue::Set(l);
        }
        if let Some(d) = input.is_disabled {
            user_obj.is_disabled = ActiveValue::Set(Some(d));
        }
        let user_obj = user_obj.update(&self.0.db).await.unwrap();
        Ok(StringIdObject { id: user_obj.id })
    }

    pub async fn update_user_preference(
        &self,
        user_id: String,
        input: UpdateComplexJsonInput,
    ) -> Result<bool> {
        let err = || Error::new("Incorrect property value encountered");
        let user_model = user_by_id(&user_id, &self.0).await?;
        let mut preferences = user_model.preferences.clone();
        match input.property.is_empty() {
            true => preferences = UserPreferences::default(),
            false => {
                let (left, right) = input.property.split_once('.').ok_or_else(err)?;
                let value_bool = input.value.parse::<bool>();
                match left {
                    "fitness" => {
                        let (left, right) = right.split_once('.').ok_or_else(err)?;
                        match left {
                            "measurements" => {
                                let (left, right) = right.split_once('.').ok_or_else(err)?;
                                match left {
                                    "custom" => {
                                        preferences.fitness.measurements.custom =
                                            serde_json::from_str(&input.value).unwrap()
                                    }
                                    "inbuilt" => match right {
                                        "weight" => {
                                            preferences.fitness.measurements.inbuilt.weight =
                                                value_bool.unwrap()
                                        }
                                        "body_mass_index" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .body_mass_index = value_bool.unwrap();
                                        }
                                        "total_body_water" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .total_body_water = value_bool.unwrap();
                                        }
                                        "muscle" => {
                                            preferences.fitness.measurements.inbuilt.muscle =
                                                value_bool.unwrap();
                                        }
                                        "lean_body_mass" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .lean_body_mass = value_bool.unwrap();
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
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .waist_circumference = value_bool.unwrap();
                                        }
                                        "waist_to_height_ratio" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .waist_to_height_ratio = value_bool.unwrap();
                                        }
                                        "hip_circumference" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .hip_circumference = value_bool.unwrap();
                                        }
                                        "waist_to_hip_ratio" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .waist_to_hip_ratio = value_bool.unwrap();
                                        }
                                        "chest_circumference" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .chest_circumference = value_bool.unwrap();
                                        }
                                        "thigh_circumference" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .thigh_circumference = value_bool.unwrap();
                                        }
                                        "biceps_circumference" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .biceps_circumference = value_bool.unwrap();
                                        }
                                        "neck_circumference" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .neck_circumference = value_bool.unwrap();
                                        }
                                        "body_fat_caliper" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .body_fat_caliper = value_bool.unwrap();
                                        }
                                        "chest_skinfold" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .chest_skinfold = value_bool.unwrap();
                                        }
                                        "abdominal_skinfold" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .abdominal_skinfold = value_bool.unwrap();
                                        }
                                        "thigh_skinfold" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .thigh_skinfold = value_bool.unwrap();
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
                                                .total_daily_energy_expenditure =
                                                value_bool.unwrap();
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
                            "exercises" => match right.split_once('.') {
                                Some((left, right)) => match left {
                                    "set_rest_timers" => {
                                        let value = input.value.parse().ok();
                                        let set_rest_timers =
                                            &mut preferences.fitness.exercises.set_rest_timers;
                                        match right {
                                            "drop" => set_rest_timers.drop = value,
                                            "normal" => set_rest_timers.normal = value,
                                            "warmup" => set_rest_timers.warmup = value,
                                            "failure" => set_rest_timers.failure = value,
                                            _ => return Err(err()),
                                        }
                                    }
                                    _ => return Err(err()),
                                },
                                None => match right {
                                    "unit_system" => {
                                        preferences.fitness.exercises.unit_system =
                                            UserUnitSystem::from_str(&input.value).unwrap();
                                    }
                                    _ => return Err(err()),
                                },
                            },
                            "logging" => match right {
                                "show_details_while_editing" => {
                                    preferences.fitness.logging.show_details_while_editing =
                                        value_bool.unwrap();
                                }
                                "mute_sounds" => {
                                    preferences.fitness.logging.mute_sounds = value_bool.unwrap();
                                }
                                _ => return Err(err()),
                            },
                            _ => return Err(err()),
                        }
                    }
                    "features_enabled" => {
                        let (left, right) = right.split_once('.').ok_or_else(err)?;
                        match left {
                            "others" => match right {
                                "collections" => {
                                    preferences.features_enabled.others.collections =
                                        value_bool.unwrap()
                                }
                                "calendar" => {
                                    preferences.features_enabled.others.calendar =
                                        value_bool.unwrap()
                                }
                                _ => return Err(err()),
                            },
                            "fitness" => match right {
                                "enabled" => {
                                    preferences.features_enabled.fitness.enabled =
                                        value_bool.unwrap()
                                }
                                "measurements" => {
                                    preferences.features_enabled.fitness.measurements =
                                        value_bool.unwrap()
                                }
                                "workouts" => {
                                    preferences.features_enabled.fitness.workouts =
                                        value_bool.unwrap()
                                }
                                "templates" => {
                                    preferences.features_enabled.fitness.templates =
                                        value_bool.unwrap()
                                }
                                _ => return Err(err()),
                            },
                            "media" => {
                                match right {
                                    "enabled" => {
                                        preferences.features_enabled.media.enabled =
                                            value_bool.unwrap()
                                    }
                                    "audio_book" => {
                                        preferences.features_enabled.media.audio_book =
                                            value_bool.unwrap()
                                    }
                                    "book" => {
                                        preferences.features_enabled.media.book =
                                            value_bool.unwrap()
                                    }
                                    "movie" => {
                                        preferences.features_enabled.media.movie =
                                            value_bool.unwrap()
                                    }
                                    "podcast" => {
                                        preferences.features_enabled.media.podcast =
                                            value_bool.unwrap()
                                    }
                                    "show" => {
                                        preferences.features_enabled.media.show =
                                            value_bool.unwrap()
                                    }
                                    "video_game" => {
                                        preferences.features_enabled.media.video_game =
                                            value_bool.unwrap()
                                    }
                                    "visual_novel" => {
                                        preferences.features_enabled.media.visual_novel =
                                            value_bool.unwrap()
                                    }
                                    "manga" => {
                                        preferences.features_enabled.media.manga =
                                            value_bool.unwrap()
                                    }
                                    "anime" => {
                                        preferences.features_enabled.media.anime =
                                            value_bool.unwrap()
                                    }
                                    "people" => {
                                        preferences.features_enabled.media.people =
                                            value_bool.unwrap()
                                    }
                                    "groups" => {
                                        preferences.features_enabled.media.groups =
                                            value_bool.unwrap()
                                    }
                                    "genres" => {
                                        preferences.features_enabled.media.genres =
                                            value_bool.unwrap()
                                    }
                                    _ => return Err(err()),
                                };
                            }
                            _ => return Err(err()),
                        }
                    }
                    "notifications" => match right {
                        "to_send" => {
                            preferences.notifications.to_send =
                                serde_json::from_str(&input.value).unwrap();
                        }
                        "enabled" => {
                            preferences.notifications.enabled = value_bool.unwrap();
                        }
                        _ => return Err(err()),
                    },
                    "general" => match right {
                        "review_scale" => {
                            preferences.general.review_scale =
                                UserReviewScale::from_str(&input.value).unwrap();
                        }
                        "grid_packing" => {
                            preferences.general.grid_packing =
                                GridPacking::from_str(&input.value).unwrap();
                        }
                        "display_nsfw" => {
                            preferences.general.display_nsfw = value_bool.unwrap();
                        }
                        "dashboard" => {
                            preferences.general.dashboard =
                                serde_json::from_str(&input.value).unwrap();
                        }
                        "disable_integrations" => {
                            preferences.general.disable_integrations = value_bool.unwrap();
                        }
                        "persist_queries" => {
                            preferences.general.persist_queries = value_bool.unwrap();
                        }
                        "disable_navigation_animation" => {
                            preferences.general.disable_navigation_animation = value_bool.unwrap();
                        }
                        "disable_videos" => {
                            preferences.general.disable_videos = value_bool.unwrap();
                        }
                        "disable_watch_providers" => {
                            preferences.general.disable_watch_providers = value_bool.unwrap();
                        }
                        "watch_providers" => {
                            preferences.general.watch_providers =
                                serde_json::from_str(&input.value).unwrap();
                        }
                        "disable_reviews" => {
                            preferences.general.disable_reviews = value_bool.unwrap();
                        }
                        _ => return Err(err()),
                    },
                    _ => return Err(err()),
                };
            }
        };
        let mut user_model: user::ActiveModel = user_model.into();
        user_model.preferences = ActiveValue::Set(preferences);
        user_model.update(&self.0.db).await?;
        Ok(true)
    }

    pub async fn update_user_integration(
        &self,
        user_id: String,
        input: UpdateUserIntegrationInput,
    ) -> Result<bool> {
        let db_integration = Integration::find_by_id(input.integration_id)
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Integration with the given id does not exist"))?;
        if db_integration.user_id != user_id {
            return Err(Error::new("Integration does not belong to the user"));
        }
        if input.minimum_progress > input.maximum_progress {
            return Err(Error::new(
                "Minimum progress cannot be greater than maximum progress",
            ));
        }
        let mut db_integration: integration::ActiveModel = db_integration.into();
        if let Some(s) = input.minimum_progress {
            db_integration.minimum_progress = ActiveValue::Set(Some(s));
        }
        if let Some(s) = input.maximum_progress {
            db_integration.maximum_progress = ActiveValue::Set(Some(s));
        }
        if let Some(d) = input.is_disabled {
            db_integration.is_disabled = ActiveValue::Set(Some(d));
        }
        db_integration.update(&self.0.db).await?;
        Ok(true)
    }

    pub async fn create_user_integration(
        &self,
        user_id: String,
        input: CreateUserIntegrationInput,
    ) -> Result<StringIdObject> {
        if input.minimum_progress > input.maximum_progress {
            return Err(Error::new(
                "Minimum progress cannot be greater than maximum progress",
            ));
        }
        let lot = match input.provider {
            IntegrationProvider::Audiobookshelf | IntegrationProvider::Komga => {
                IntegrationLot::Yank
            }
            IntegrationProvider::Radarr
            | IntegrationProvider::Sonarr
            | IntegrationProvider::JellyfinPush => IntegrationLot::Push,
            _ => IntegrationLot::Sink,
        };
        let to_insert = integration::ActiveModel {
            lot: ActiveValue::Set(lot),
            user_id: ActiveValue::Set(user_id),
            provider: ActiveValue::Set(input.provider),
            minimum_progress: ActiveValue::Set(input.minimum_progress),
            maximum_progress: ActiveValue::Set(input.maximum_progress),
            provider_specifics: ActiveValue::Set(input.provider_specifics),
            ..Default::default()
        };
        let integration = to_insert.insert(&self.0.db).await?;
        Ok(StringIdObject { id: integration.id })
    }

    pub async fn delete_user_integration(
        &self,
        user_id: String,
        integration_id: String,
    ) -> Result<bool> {
        let integration = Integration::find_by_id(integration_id)
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Integration with the given id does not exist"))?;
        if integration.user_id != user_id {
            return Err(Error::new("Integration does not belong to the user"));
        }
        integration.delete(&self.0.db).await?;
        Ok(true)
    }

    pub async fn create_user_notification_platform(
        &self,
        user_id: String,
        input: CreateUserNotificationPlatformInput,
    ) -> Result<String> {
        let specifics = match input.lot {
            NotificationPlatformLot::Apprise => NotificationPlatformSpecifics::Apprise {
                url: input.base_url.unwrap(),
                key: input.api_token.unwrap(),
            },
            NotificationPlatformLot::Discord => NotificationPlatformSpecifics::Discord {
                url: input.base_url.unwrap(),
            },
            NotificationPlatformLot::Gotify => NotificationPlatformSpecifics::Gotify {
                url: input.base_url.unwrap(),
                token: input.api_token.unwrap(),
                priority: input.priority,
            },
            NotificationPlatformLot::Ntfy => NotificationPlatformSpecifics::Ntfy {
                url: input.base_url,
                topic: input.api_token.unwrap(),
                priority: input.priority,
                auth_header: input.auth_header,
            },
            NotificationPlatformLot::PushBullet => NotificationPlatformSpecifics::PushBullet {
                api_token: input.api_token.unwrap(),
            },
            NotificationPlatformLot::PushOver => NotificationPlatformSpecifics::PushOver {
                key: input.api_token.unwrap(),
                app_key: input.auth_header,
            },
            NotificationPlatformLot::PushSafer => NotificationPlatformSpecifics::PushSafer {
                key: input.api_token.unwrap(),
            },
            NotificationPlatformLot::Email => NotificationPlatformSpecifics::Email {
                email: input.api_token.unwrap(),
            },
            NotificationPlatformLot::Telegram => NotificationPlatformSpecifics::Telegram {
                bot_token: input.api_token.unwrap(),
                chat_id: input.chat_id.unwrap(),
            },
        };
        let description = match &specifics {
            NotificationPlatformSpecifics::Apprise { url, key } => {
                format!("URL: {}, Key: {}", url, key)
            }
            NotificationPlatformSpecifics::Discord { url } => {
                format!("Webhook: {}", url)
            }
            NotificationPlatformSpecifics::Gotify { url, token, .. } => {
                format!("URL: {}, Token: {}", url, token)
            }
            NotificationPlatformSpecifics::Ntfy { url, topic, .. } => {
                format!("URL: {:?}, Topic: {}", url, topic)
            }
            NotificationPlatformSpecifics::PushBullet { api_token } => {
                format!("API Token: {}", api_token)
            }
            NotificationPlatformSpecifics::PushOver { key, app_key } => {
                format!("Key: {}, App Key: {:?}", key, app_key)
            }
            NotificationPlatformSpecifics::PushSafer { key } => {
                format!("Key: {}", key)
            }
            NotificationPlatformSpecifics::Email { email } => {
                format!("ID: {}", email)
            }
            NotificationPlatformSpecifics::Telegram { chat_id, .. } => {
                format!("Chat ID: {}", chat_id)
            }
        };
        let notification = notification_platform::ActiveModel {
            lot: ActiveValue::Set(input.lot),
            user_id: ActiveValue::Set(user_id),
            platform_specifics: ActiveValue::Set(specifics),
            description: ActiveValue::Set(description),
            ..Default::default()
        };
        let new_notification_id = notification.insert(&self.0.db).await?.id;
        Ok(new_notification_id)
    }

    pub async fn update_user_notification_platform(
        &self,
        user_id: String,
        input: UpdateUserNotificationPlatformInput,
    ) -> Result<bool> {
        let db_notification = NotificationPlatform::find_by_id(input.notification_id)
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Notification platform with the given id does not exist"))?;
        if db_notification.user_id != user_id {
            return Err(Error::new(
                "Notification platform does not belong to the user",
            ));
        }
        let mut db_notification: notification_platform::ActiveModel = db_notification.into();
        if let Some(s) = input.is_disabled {
            db_notification.is_disabled = ActiveValue::Set(Some(s));
        }
        db_notification.update(&self.0.db).await?;
        Ok(true)
    }

    pub async fn delete_user_notification_platform(
        &self,
        user_id: String,
        notification_id: String,
    ) -> Result<bool> {
        let notification = NotificationPlatform::find_by_id(notification_id)
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Notification platform with the given id does not exist"))?;
        if notification.user_id != user_id {
            return Err(Error::new(
                "Notification platform does not belong to the user",
            ));
        }
        notification.delete(&self.0.db).await?;
        Ok(true)
    }

    pub async fn test_user_notification_platforms(&self, user_id: &String) -> Result<bool> {
        let notifications = NotificationPlatform::find()
            .filter(notification_platform::Column::UserId.eq(user_id))
            .all(&self.0.db)
            .await?;
        for platform in notifications {
            if platform.is_disabled.unwrap_or_default() {
                continue;
            }
            let msg = format!("This is a test notification for platform: {}", platform.lot);
            send_notification(platform.platform_specifics, &self.0.config, &msg).await?;
        }
        Ok(true)
    }

    pub async fn user_details(&self, token: &str) -> Result<UserDetailsResult> {
        let found_token = user_id_from_token(token, &self.0.config.users.jwt_secret);
        let Ok(user_id) = found_token else {
            return Ok(UserDetailsResult::Error(UserDetailsError {
                error: UserDetailsErrorVariant::AuthTokenInvalid,
            }));
        };
        let user = user_by_id(&user_id, &self.0).await?;
        Ok(UserDetailsResult::Ok(Box::new(user)))
    }

    pub async fn user_integrations(&self, user_id: &String) -> Result<Vec<integration::Model>> {
        let integrations = Integration::find()
            .filter(integration::Column::UserId.eq(user_id))
            .all(&self.0.db)
            .await?;
        Ok(integrations)
    }

    pub async fn user_notification_platforms(
        &self,
        user_id: &String,
    ) -> Result<Vec<notification_platform::Model>> {
        let all_notifications = NotificationPlatform::find()
            .filter(notification_platform::Column::UserId.eq(user_id))
            .all(&self.0.db)
            .await?;
        Ok(all_notifications)
    }

    pub async fn get_oidc_redirect_url(&self) -> Result<String> {
        let Some(client) = self.0.oidc_client.as_ref() else {
            return Err(Error::new("OIDC client not configured"));
        };
        let (authorize_url, _, _) = client
            .authorize_url(
                AuthenticationFlow::<CoreResponseType>::AuthorizationCode,
                CsrfToken::new_random,
                Nonce::new_random,
            )
            .add_scope(Scope::new("email".to_string()))
            .url();
        Ok(authorize_url.to_string())
    }

    pub async fn get_oidc_token(&self, code: String) -> Result<OidcTokenOutput> {
        let Some(client) = self.0.oidc_client.as_ref() else {
            return Err(Error::new("OIDC client not configured"));
        };
        let token = client
            .exchange_code(AuthorizationCode::new(code))
            .request_async(async_http_client)
            .await?;
        let id_token = token.id_token().unwrap();
        let claims = id_token.claims(&client.id_token_verifier(), empty_nonce_verifier)?;
        let subject = claims.subject().to_string();
        let email = claims
            .email()
            .map(|e| e.to_string())
            .ok_or_else(|| Error::new("Email not found in OIDC token claims"))?;
        Ok(OidcTokenOutput { subject, email })
    }

    pub async fn user_by_oidc_issuer_id(&self, oidc_issuer_id: String) -> Result<Option<String>> {
        let user = User::find()
            .filter(user::Column::OidcIssuerId.eq(oidc_issuer_id))
            .one(&self.0.db)
            .await?
            .map(|u| u.id);
        Ok(user)
    }
}
