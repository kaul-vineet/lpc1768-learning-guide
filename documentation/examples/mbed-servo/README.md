# Mbed Servo
A servo library for mbed

## Usage
### Controlling a Servo

1. Create a servo object

```cpp
Servo servo(D4);
```

2. Enable the servo and move to initial position

```cpp
servo.attach(SERVO_POS_CENTER);
```
The initial position is specified in degress. Constants are available for 0° (`SERVO_POS_CENTER`), -90° (`SERVO_POS_MIN`), and +90° (`SERVO_POS_MAX`).

3. Control servo position

```cpp
// set new position in degrees
servo.write(position_degrees);

// get current position in degrees
int current = servo.read();
```

4. Disable servo
```cpp
servo.detach();
```
(This will stop all timers and any changes to the servo will not be applied)
