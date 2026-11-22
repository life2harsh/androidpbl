import threading

import cv2
import numpy as np
import onnxruntime as ort


class Detector:
    def __init__(self, path, names, threads=3):
        o = ort.SessionOptions()
        o.intra_op_num_threads = threads
        self.sess = ort.InferenceSession(path, o, providers=["CPUExecutionProvider"])
        self.size = self.sess.get_inputs()[0].shape[2]
        self.names = [n.strip().replace(" ", "_") for n in open(names) if n.strip()]
        self.lock = threading.Lock()

    def __call__(self, img, thresh=0.3):
        h, w = img.shape[:2]
        k = self.size / max(h, w)
        pad = np.full((self.size, self.size, 3), 114, np.uint8)
        pad[:int(h * k), :int(w * k)] = cv2.resize(img, (int(w * k), int(h * k)))
        with self.lock:
            o = self.sess.run(None, {"images": cv2.dnn.blobFromImage(pad, 1 / 255, swapRB=True)})[0][0].T
        sc = o[:, 4:]
        i = sc.argmax(1)
        s = sc[np.arange(len(i)), i]
        m = s > thresh
        b = o[m, :4] / k
        b[:, :2] -= b[:, 2:] / 2
        keep = cv2.dnn.NMSBoxes(b.tolist(), s[m].tolist(), thresh, 0.5) if m.any() else []
        return [{"cls": self.names[i[m][j]], "score": round(float(s[m][j]), 2), "box": [round(v) for v in b[j]]}
                for j in np.array(keep).flatten()]
