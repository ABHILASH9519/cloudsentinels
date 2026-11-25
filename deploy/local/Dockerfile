FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY bridge.py watch.py ./
RUN mkdir -p /var/lib/cloudsentinels && chown 65534:65534 /var/lib/cloudsentinels
USER 65534:65534
CMD ["python", "-u", "bridge.py"]
