FROM ignisda/archlinux:latest

USER root

USER $USERNAME
RUN paru -Syy --noconfirm caddy
RUN cargo binstall sea-orm-cli cargo-dist --locked --secure --no-confirm
