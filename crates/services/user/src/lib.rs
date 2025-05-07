use std::{collections::HashSet, sync::Arc, time::Instant};

use application_utils::{create_oidc_client, user_id_from_token};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use async_graphql::{Error, Result};
use chrono::Utc;
use common_models::{DefaultCollection, StringIdObject, UserLevelCacheKey};
use common_utils::{MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS, ryot_log};
use database_models::{
    access_link, integration, metadata, metadata_to_metadata, notification_platform,
    prelude::{AccessLink, Integration, Metadata, MetadataToMetadata, NotificationPlatform, User},
    user, user_to_entity,
};
use database_utils::{
    admin_account_guard, deploy_job_to_calculate_user_activities_and_summary, get_user_query,
    ilike_sql, revoke_access_link, server_key_validation_guard, user_by_id,
};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, ApplicationRecommendations, CachedResponse,
    UserDetailsResult, UserMetadataRecommendationsResponse,
};
use dependent_utils::{
    create_or_update_collection, generic_metadata, update_metadata_and_notify_users,
};
use enum_meta::Meta;
use enum_models::{
    IntegrationLot, IntegrationProvider, MetadataToMetadataRelation, NotificationPlatformLot,
    UserLot, UserNotificationContent,
};
use itertools::Itertools;
use jwt_service::sign;
use media_models::{
    AuthUserInput, CreateAccessLinkInput, CreateOrUpdateCollectionInput,
    CreateOrUpdateUserIntegrationInput, CreateUserNotificationPlatformInput, LoginError,
    LoginErrorVariant, LoginResponse, LoginResult, OidcTokenOutput, PasswordUserInput,
    ProcessAccessLinkError, ProcessAccessLinkErrorVariant, ProcessAccessLinkInput,
    ProcessAccessLinkResponse, ProcessAccessLinkResult, RegisterError, RegisterErrorVariant,
    RegisterResult, RegisterUserInput, UpdateUserNotificationPlatformInput, UserDetailsError,
    UserDetailsErrorVariant,
};
use nanoid::nanoid;
use notification_service::send_notification;
use openidconnect::{
    AuthorizationCode, CsrfToken, Nonce, Scope, TokenResponse, core::CoreAuthenticationFlow,
};
use rand::seq::{IndexedRandom, SliceRandom};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, Condition, DatabaseBackend, EntityTrait,
    FromQueryResult, Iterable, JoinType, ModelTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, QueryTrait, RelationTrait, Statement,
    prelude::Expr,
    sea_query::{Func, extension::postgres::PgExpr},
};
use supporting_service::SupportingService;
use user_models::{
    DashboardElementLot, NotificationPlatformSpecifics, UpdateUserInput, UserPreferences,
};

fn empty_nonce_verifier(_nonce: Option<&Nonce>) -> Result<(), String> {
    Ok(())
}

pub struct UserService(pub Arc<SupportingService>);

impl UserService {
    pub async fn user_metadata_recommendations(
        &self,
        user_id: &String,
    ) -> Result<CachedResponse<UserMetadataRecommendationsResponse>> {
        let cc = &self.0.cache_service;
        let metadata_recommendations_key =
            ApplicationCacheKey::UserMetadataRecommendations(UserLevelCacheKey {
                input: (),
                user_id: user_id.to_owned(),
            });

        if let Some((id, recommendations)) = cc
            .get_value::<UserMetadataRecommendationsResponse>(metadata_recommendations_key.clone())
            .await
        {
            return Ok(CachedResponse {
                cache_id: id,
                response: recommendations,
            });
        };
        let metadata_count = Metadata::find().count(&self.0.db).await?;
        let recommendations = match metadata_count {
            0 => vec![],
            _ => {
                let calculated_recommendations = 'calc: {
                    let cc = &self.0.cache_service;
                    let key =
                        ApplicationCacheKey::UserMetadataRecommendationsSet(UserLevelCacheKey {
                            input: (),
                            user_id: user_id.to_owned(),
                        });
                    if let Some((_, recommendations)) = cc
                        .get_value::<ApplicationRecommendations>(key.clone())
                        .await
                    {
                        break 'calc recommendations;
                    }
                    #[derive(Debug, FromQueryResult)]
                    struct CustomQueryResponse {
                        id: String,
                    }
                    let mut args = vec![user_id.into()];
                    args.extend(
                        MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS
                            .into_iter()
                            .map(|s| s.into()),
                    );
                    let media_items =
                        CustomQueryResponse::find_by_statement(Statement::from_sql_and_values(
                            DatabaseBackend::Postgres,
                            r#"
SELECT "m"."id"
FROM (
    SELECT "user_id", "metadata_id" FROM "user_to_entity"
    WHERE "user_id" = $1 AND "metadata_id" IS NOT NULL
) "sub"
JOIN "metadata" "m" ON "sub"."metadata_id" = "m"."id" AND "m"."source" NOT IN ($2, $3, $4, $5)
ORDER BY RANDOM() LIMIT 10;
        "#,
                            args,
                        ))
                        .all(&self.0.db)
                        .await?;
                    ryot_log!(
                        debug,
                        "Media items selected for recommendations: {:?}",
                        media_items
                    );
                    let mut media_item_ids = vec![];
                    for media in media_items.into_iter() {
                        ryot_log!(debug, "Getting recommendations: {:?}", media);
                        update_metadata_and_notify_users(&media.id, &self.0).await?;
                        let recommendations =
                            generic_metadata(&media.id, &self.0).await?.suggestions;
                        ryot_log!(debug, "Found recommendations: {:?}", recommendations);
                        for rec in recommendations {
                            let relation = metadata_to_metadata::ActiveModel {
                                to_metadata_id: ActiveValue::Set(rec.clone()),
                                from_metadata_id: ActiveValue::Set(media.id.clone()),
                                relation: ActiveValue::Set(MetadataToMetadataRelation::Suggestion),
                                ..Default::default()
                            };
                            MetadataToMetadata::insert(relation)
                                .on_conflict_do_nothing()
                                .exec(&self.0.db)
                                .await
                                .ok();
                            media_item_ids.push(rec);
                        }
                    }
                    self.0
                        .cache_service
                        .set_key(
                            key,
                            ApplicationCacheValue::UserMetadataRecommendationsSet(
                                media_item_ids.clone(),
                            ),
                        )
                        .await?;
                    media_item_ids
                };
                let preferences = user_by_id(user_id, &self.0).await?.preferences;
                let limit = preferences
                    .general
                    .dashboard
                    .into_iter()
                    .find(|d| d.section == DashboardElementLot::Recommendations)
                    .unwrap()
                    .num_elements
                    .unwrap();
                let enabled = preferences.features_enabled.media.specific;
                let started_at = Instant::now();
                let mut recommendations = HashSet::new();
                for i in 0.. {
                    let now = Instant::now();
                    if recommendations.len() >= limit.try_into().unwrap()
                        || now.duration_since(started_at).as_secs() > 5
                    {
                        break;
                    }
                    ryot_log!(debug, "Recommendations loop {} for user: {}", i, user_id);
                    let selected_lot = enabled.choose(&mut rand::rng()).unwrap();
                    let cloned_user_id = user_id.clone();
                    let rec = Metadata::find()
                        .select_only()
                        .column(metadata::Column::Id)
                        .filter(metadata::Column::Lot.eq(*selected_lot))
                        .join(
                            JoinType::LeftJoin,
                            metadata::Relation::UserToEntity.def().on_condition(
                                move |_left, right| {
                                    Condition::all().add(
                                        Expr::col((right, user_to_entity::Column::UserId))
                                            .eq(cloned_user_id.clone()),
                                    )
                                },
                            ),
                        )
                        .filter(user_to_entity::Column::Id.is_null())
                        .apply_if(
                            (!calculated_recommendations.is_empty()).then_some(0),
                            |query, _| {
                                query
                                    .filter(metadata::Column::Id.is_in(&calculated_recommendations))
                            },
                        )
                        .order_by_desc(Expr::expr(Func::md5(
                            Expr::col(metadata::Column::Title).concat(Expr::val(nanoid!(12))),
                        )))
                        .into_tuple::<String>()
                        .one(&self.0.db)
                        .await?;
                    if let Some(rec) = rec {
                        recommendations.insert(rec);
                    }
                }
                let mut recommendations = recommendations.into_iter().collect_vec();
                recommendations.shuffle(&mut rand::rng());
                recommendations
            }
        };
        let cc = &self.0.cache_service;
        let id = cc
            .set_key(
                metadata_recommendations_key,
                ApplicationCacheValue::UserMetadataRecommendations(recommendations.clone()),
            )
            .await?;
        Ok(CachedResponse {
            cache_id: id,
            response: recommendations,
        })
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
        server_key_validation_guard(self.0.is_server_key_validated().await?).await?;
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
                let user = get_user_query()
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
                }));
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
            Some(link.id.clone()),
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
        server_key_validation_guard(self.0.is_server_key_validated().await?).await?;
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
                &user.id,
                &self.0,
                CreateOrUpdateCollectionInput {
                    name: col.to_string(),
                    information_template: meta.0,
                    description: Some(meta.1.to_owned()),
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
        input: UserPreferences,
    ) -> Result<bool> {
        let user_model = user_by_id(&user_id, &self.0).await?;
        let mut user_model: user::ActiveModel = user_model.into();
        user_model.preferences = ActiveValue::Set(input);
        user_model.update(&self.0.db).await?;
        Ok(true)
    }

    pub async fn create_or_update_user_integration(
        &self,
        user_id: String,
        input: CreateOrUpdateUserIntegrationInput,
    ) -> Result<bool> {
        let mut lot = ActiveValue::NotSet;
        let mut provider = ActiveValue::NotSet;
        if let Some(p) = input.provider {
            match p {
                IntegrationProvider::JellyfinPush | IntegrationProvider::YoutubeMusic => {
                    server_key_validation_guard(self.0.is_server_key_validated().await?).await?;
                }
                _ => {}
            }
            let l = match p {
                IntegrationProvider::Komga
                | IntegrationProvider::PlexYank
                | IntegrationProvider::YoutubeMusic
                | IntegrationProvider::Audiobookshelf => IntegrationLot::Yank,
                IntegrationProvider::Radarr
                | IntegrationProvider::Sonarr
                | IntegrationProvider::JellyfinPush => IntegrationLot::Push,
                _ => IntegrationLot::Sink,
            };
            lot = ActiveValue::Set(l);
            provider = ActiveValue::Set(p);
        };
        if input.minimum_progress > input.maximum_progress {
            return Err(Error::new(
                "Minimum progress cannot be greater than maximum progress",
            ));
        }
        let id = match input.integration_id {
            None => ActiveValue::NotSet,
            Some(id) => ActiveValue::Set(id),
        };
        let to_insert = integration::ActiveModel {
            id,
            lot,
            provider,
            name: ActiveValue::Set(input.name),
            user_id: ActiveValue::Set(user_id),
            is_disabled: ActiveValue::Set(input.is_disabled),
            extra_settings: ActiveValue::Set(input.extra_settings),
            minimum_progress: ActiveValue::Set(input.minimum_progress),
            maximum_progress: ActiveValue::Set(input.maximum_progress),
            provider_specifics: ActiveValue::Set(input.provider_specifics),
            sync_to_owned_collection: ActiveValue::Set(input.sync_to_owned_collection),
            ..Default::default()
        };
        to_insert.save(&self.0.db).await?;
        Ok(true)
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
            NotificationPlatformSpecifics::Telegram { chat_id, .. } => {
                format!("Chat ID: {}", chat_id)
            }
        };
        let notification = notification_platform::ActiveModel {
            lot: ActiveValue::Set(input.lot),
            user_id: ActiveValue::Set(user_id),
            description: ActiveValue::Set(description),
            platform_specifics: ActiveValue::Set(specifics),
            configured_events: ActiveValue::Set(UserNotificationContent::iter().collect()),
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
        if let Some(e) = input.configured_events {
            db_notification.configured_events = ActiveValue::Set(e);
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
            send_notification(platform.platform_specifics, &msg).await?;
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
            .order_by_desc(integration::Column::CreatedOn)
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
        let Some((_http, client)) = create_oidc_client(&self.0.config).await else {
            return Err(Error::new("OIDC client not configured"));
        };
        let (authorize_url, _, _) = client
            .authorize_url(
                CoreAuthenticationFlow::AuthorizationCode,
                CsrfToken::new_random,
                Nonce::new_random,
            )
            .add_scope(Scope::new("email".to_string()))
            .url();
        Ok(authorize_url.to_string())
    }

    pub async fn get_oidc_token(&self, code: String) -> Result<OidcTokenOutput> {
        let Some((http, client)) = create_oidc_client(&self.0.config).await else {
            return Err(Error::new("OIDC client not configured"));
        };
        let token = client
            .exchange_code(AuthorizationCode::new(code))?
            .request_async(&http)
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
        let user = get_user_query()
            .filter(user::Column::OidcIssuerId.eq(oidc_issuer_id))
            .one(&self.0.db)
            .await?
            .map(|u| u.id);
        Ok(user)
    }
}
