FROM python:3.11-slim-bookworm
RUN pip install --no-cache-dir "opencv-python-headless<5" "numpy<3" "onnxruntime<2" "paho-mqtt>=2,<3"
WORKDIR /app
COPY vision/vision.py iot/hub/hub.py iot/hub/detect.py ./
CMD ["python", "-u", "hub.py"]
