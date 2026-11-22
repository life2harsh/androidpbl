FROM python:3.11-slim-bookworm
RUN pip install --no-cache-dir opencv-python-headless numpy paho-mqtt
WORKDIR /app
COPY vision/vision.py iot/hub/hub.py iot/hub/detect.py ./
CMD ["python", "-u", "hub.py"]
