FROM postgres:18.4-alpine3.22@sha256:774521500f4c22761b25a6bdb772a0a3c2e8dd32468210bdad9231c5752ea398

USER root
RUN apk add --no-cache nodejs=22.23.2-r0 openssl=3.5.7-r0
USER postgres
ENTRYPOINT ["/bin/bash"]
