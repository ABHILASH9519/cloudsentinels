FROM python:3.12-slim

ARG KUBECTL_VERSION=v1.32.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
    && chmod 0755 /usr/local/bin/kubectl \
    && apt-get purge -y --auto-remove curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY cluster-agent.py /app/cluster-agent.py
RUN mkdir -p /data && chown -R 65532:65532 /app /data
USER 65532:65532

ENV SPOOL_DB_PATH=/data/events.sqlite3
ENTRYPOINT ["python", "/app/cluster-agent.py"]
