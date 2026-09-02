/*
MIT License

Copyright (c) 2020 Steffen S.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

#include <mbed.h>
#include <Servo.h>

Servo servo(D4);

int main() {

    // enable servo and set position to -90 degrees
    servo.attach(SERVO_POS_MIN);

    while(1) {
      // Sweep across whole servo range from -90 degrees to +90 degrees
      for (int i = SERVO_POS_MIN; i <= SERVO_POS_MAX; i++)
      {
        servo.write(i);
        wait_us(10000);
      }

      // Sweep back from 90 degrees to -90 degrees
      for (int i = SERVO_POS_MAX; i >= SERVO_POS_MIN; i--)
      {
        servo.write(i);
        wait_us(10000);
      }

      wait_us(1000000);
    }
  }
