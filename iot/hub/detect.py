import threading

import cv2
import numpy as np

CLASSES = ("person bicycle car motorcycle airplane bus train truck boat traffic_light fire_hydrant stop_sign parking_meter "
           "bench bird cat dog horse sheep cow elephant bear zebra giraffe backpack umbrella handbag tie suitcase frisbee "
           "skis snowboard sports_ball kite baseball_bat baseball_glove skateboard surfboard tennis_racket bottle wine_glass "
           "cup fork knife spoon bowl banana apple sandwich orange broccoli carrot hot_dog pizza donut cake chair couch "
           "potted_plant bed dining_table toilet tv laptop mouse remote keyboard cell_phone microwave oven toaster sink "
           "refrigerator book clock vase scissors teddy_bear hair_drier toothbrush").split()
SIZE, STRIDES, BINS = 416, (8, 16, 32), 8
MEAN = np.array([103.53, 116.28, 123.675], np.float32)
STD = np.array([57.375, 57.12, 58.395], np.float32)
CENTERS = [np.stack(np.meshgrid(np.arange(SIZE // s) * s, np.arange(SIZE // s) * s), -1).reshape(-1, 2) + 0.5 * (s - 1) for s in STRIDES]


class Detector:
    def __init__(self, path):
        self.net = cv2.dnn.readNet(path)
        self.out = self.net.getUnconnectedOutLayersNames()
        self.lock = threading.Lock()

    def __call__(self, img, thresh=0.4):
        h, w = img.shape[:2]
        k = SIZE / max(h, w)
        pad = np.zeros((SIZE, SIZE, 3), np.float32)
        pad[:int(h * k), :int(w * k)] = cv2.resize(img, (int(w * k), int(h * k)))
        with self.lock:
            self.net.setInput(cv2.dnn.blobFromImage((pad - MEAN) / STD))
            outs = self.net.forward(self.out)
        outs = sorted(outs, key=lambda o: (o.shape[1], o.shape[2]), reverse=True)
        boxes, scores, ids = [], [], []
        for (cls, reg), c, s in zip(zip(outs[::2], outs[1::2]), CENTERS, STRIDES):
            cls, reg = cls[0], reg[0]
            p = np.exp(reg.reshape(-1, BINS))
            d = ((p / p.sum(1, keepdims=True)) @ np.arange(BINS)).reshape(-1, 4) * s
            i = cls.argmax(1)
            sc = cls[np.arange(len(i)), i]
            m = sc > thresh
            xy0, xy1 = c[m] - d[m, :2], c[m] + d[m, 2:]
            boxes += np.hstack([xy0, xy1 - xy0]).tolist()
            scores += sc[m].tolist()
            ids += i[m].tolist()
        keep = cv2.dnn.NMSBoxes(boxes, scores, thresh, 0.6) if boxes else []
        return [{"cls": CLASSES[ids[j]], "score": round(scores[j], 2),
                 "box": [round(v / k) for v in boxes[j]]} for j in np.array(keep).flatten()]
