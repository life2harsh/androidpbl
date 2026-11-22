# Accelerometer dead reckoning test (2026-11-23)

Question: can the MPU6050 accelerometer measure how far the rover moved?

Method: `/acctest` on the rover logs the firmware's averaged accelerometer and gyro (about 10 Hz, each sample the mean of about 10 readings at 100 Hz) while the rover rests 1.5 s, drives 0.8 s, and rests again. `tools/acc_analysis.py` finds the forward axis, removes gravity (optionally tracking tilt with the gyro), integrates twice, and optionally applies a zero-speed reset at the end. The reference is the change in sonar distance.

| Run | Sonar (front / rear) | Accel, no tilt fix | Accel, gyro tilt fix | Accel, tilt fix + zero-speed reset | Speed left after stopping |
|---|---|---|---|---|---|
| 0.8 s reverse | 15.2 / 16.1 cm | 62.0 cm | 49.8 cm | 68.5 cm | 0.13 m/s |
| 0.8 s forward | 11.3 / 15.8 cm | 59.9 cm | 57.0 cm | 65.7 cm | 0.05 m/s |

Runs where the rover rotated more than about 5° were discarded, because the sonar then measured a different object.

Result: the accelerometer overestimated a 11-16 cm move by 35-55 cm (4-5x). Peak deviations reached 0.2 g even after averaging, from start/stop pitch and chassis vibration. It is not usable for distance on this chassis. Wheel encoders or an optical flow sensor would be needed.
