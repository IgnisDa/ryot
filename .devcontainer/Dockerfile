FROM ignisda/archlinux:latest

USER root
RUN npm install --global typescript-language-server
RUN curl -L https://github.com/rome/tools/releases/download/cli%2Fv12.0.0/rome-linux-x64 -o /usr/bin/rome
RUN chmod +x /usr/bin/rome

USER $USERNAME
