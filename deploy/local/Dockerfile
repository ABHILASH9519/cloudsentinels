FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir boto3==1.40.75
COPY bridge.py .
USER 65534:65534
CMD ["python", "-u", "bridge.py"]
