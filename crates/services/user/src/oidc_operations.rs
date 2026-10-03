use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use common_utils::generate_session_id;
use database_models::{prelude::User, user};
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, OidcAuthorizationSessionValue};
use media_models::{
    AuthUserInput, CompleteOidcLoginInput, LoginResult, OidcAuthorizationResponse, OidcUserInput,
    RegisterErrorVariant, RegisterResult, RegisterUserInput,
};
use oidc_utils::create_oidc_client;
use openidconnect::{
    AccessTokenHash, AuthorizationCode, CsrfToken, Nonce, OAuth2TokenResponse, PkceCodeChallenge,
    PkceCodeVerifier, Scope, TokenResponse, core::CoreAuthenticationFlow,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use supporting_service::SupportingService;

use crate::{
    authentication_operations::login_authenticated_user, authorization::secrets_match,
    user_management_operations::register_verified_user,
};

pub async fn get_oidc_redirect_url(
    ss: &Arc<SupportingService>,
) -> Result<OidcAuthorizationResponse> {
    let Some((_http, client)) = create_oidc_client(&ss.config).await else {
        bail!("OIDC client not configured");
    };
    let browser_token = generate_session_id(None);
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let (authorize_url, state, nonce) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .set_pkce_challenge(challenge)
        .add_scope(Scope::new("email".to_string()))
        .url();
    cache_service::set_key(
        ss,
        ApplicationCacheKey::OidcAuthorizationSession(state.secret().clone()),
        ApplicationCacheValue::OidcAuthorizationSession(OidcAuthorizationSessionValue {
            nonce: nonce.secret().clone(),
            browser_token: browser_token.clone(),
            pkce_verifier: verifier.secret().clone(),
        }),
    )
    .await?;
    Ok(OidcAuthorizationResponse {
        browser_token,
        authorization_url: authorize_url.to_string(),
    })
}

pub async fn complete_oidc_login(
    ss: &Arc<SupportingService>,
    input: CompleteOidcLoginInput,
) -> Result<LoginResult> {
    let key = ApplicationCacheKey::OidcAuthorizationSession(input.state);
    let Some((_, session)) =
        cache_service::get_value::<OidcAuthorizationSessionValue>(ss, key.clone()).await
    else {
        bail!("OIDC authorization session not found or expired");
    };
    if !secrets_match(&input.browser_token, &session.browser_token) {
        bail!("Invalid OIDC browser session");
    }
    let Some(session) =
        cache_service::consume_value::<OidcAuthorizationSessionValue>(ss, key).await?
    else {
        bail!("OIDC authorization session not found or expired");
    };
    if !secrets_match(&input.browser_token, &session.browser_token) {
        bail!("Invalid OIDC browser session");
    }
    let Some((http, client)) = create_oidc_client(&ss.config).await else {
        bail!("OIDC client not configured");
    };
    let token = client
        .exchange_code(AuthorizationCode::new(input.code))?
        .set_pkce_verifier(PkceCodeVerifier::new(session.pkce_verifier))
        .request_async(&http)
        .await?;
    let id_token = token
        .id_token()
        .ok_or_else(|| anyhow!("ID token not returned by OIDC provider"))?;
    let verifier = client.id_token_verifier();
    let claims = id_token.claims(&verifier, &Nonce::new(session.nonce))?;
    if let Some(expected_hash) = claims.access_token_hash() {
        let actual_hash = AccessTokenHash::from_token(
            token.access_token(),
            id_token.signing_alg()?,
            id_token.signing_key(&verifier)?,
        )?;
        if actual_hash != *expected_hash {
            bail!("Invalid OIDC access token hash");
        }
    }
    let subject = claims.subject().to_string();
    let existing_user = User::find()
        .filter(user::Column::OidcIssuerId.eq(&subject))
        .one(&ss.db)
        .await?;
    let user = match existing_user {
        Some(user) => user,
        None => {
            let email = claims
                .email()
                .map(|email| email.to_string())
                .ok_or_else(|| anyhow!("Email not found in OIDC token claims"))?;
            let result = register_verified_user(
                ss,
                None,
                RegisterUserInput {
                    lot: None,
                    user_id: None,
                    admin_access_token: None,
                    data: AuthUserInput::Oidc(OidcUserInput {
                        email,
                        issuer_id: subject.clone(),
                    }),
                },
            )
            .await?;
            let registered_user = match result {
                RegisterResult::Ok(user) => User::find_by_id(user.id).one(&ss.db).await?,
                RegisterResult::Error(error) => match error.error {
                    RegisterErrorVariant::Disabled => bail!("Registration is disabled"),
                    RegisterErrorVariant::IdentifierAlreadyExists => {
                        User::find()
                            .filter(user::Column::OidcIssuerId.eq(subject))
                            .one(&ss.db)
                            .await?
                    }
                },
            };
            registered_user.ok_or_else(|| anyhow!("OIDC user could not be registered"))?
        }
    };
    login_authenticated_user(ss, user).await
}
