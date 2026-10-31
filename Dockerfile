# Temporary placeholder image for the test stand.
# Replaced by the Next.js + Payload build when the app skeleton lands.
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Serverless Containers passes the port in PORT (8080 by default).
ENV PORT=8080

# Commit of this build; /healthz returns it so CI can see the new revision is live.
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}

COPY stub/default.conf.template /etc/nginx/templates/default.conf.template
COPY stub/index.html /usr/share/nginx/html/index.html
COPY public/brand/logo-main.svg /usr/share/nginx/html/logo.svg

EXPOSE 8080
