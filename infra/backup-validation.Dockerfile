FROM postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94

USER root
RUN apk add --no-cache nodejs=22.23.2-r0 openssl=3.5.7-r0
USER postgres
ENTRYPOINT ["/bin/bash"]
