/*
 * arduino-manual.ino
 * 
 * This module reads in inputs from a joystick, parses the user's intent, and sends the appropriate commands to the right motors
 * 
 * Requires Sabertooth library installed in arduino libraries folder
 * https://www.dimensionengineering.com/info/arduino
 * https://www.dimensionengineering.com/software/SabertoothArduinoLibraries.zip
 * 
 * The production joystick is a three axis joystick (X, Y, and Z)
 * 
 * 
 * Potentiometer diagram (X and Y axes):
 *      O
 *     /|\
 *    + S -
 *    
 * Note: for some weird reason, on the production joystick, 
 * the Z pot uses the red and white wires as +/- leads and the black as the sweeper
 * 
 * Development Environment Setup: Instructions not intended for production use
 * Note: a breadboard may be handy to connect multiple leads to single pins.
 * Joystick Setup
 * 1. Connect the positive leads on the X and Y potentiometers (leftmost) to 5v pin on Arduino.
 * 2. Connect the negative leads on the X and Y potentiometers (rightmost) to GND pin on Arduino.
 * 3. Connect the X and Y sweepers (middle) to analog pins A0 and A1 respectively.
 * 4. Connect the positive lead on the Z potentiometer (red wire) to the 5v pin on Arduino.
 * 5. Connect the negative lead on the Z potentiometer (white wire) to the GND pin on Arduino.
 * 6. Connect the Z sweeper (black wire) to the analog pin A2
 * 7. Connect Arduino to computer and upload this program to the board (see Arduino documentation).
 * 8. Open serial monitor in Arduino IDE to view output.
 * 
 * Motor Driver Setup
 * 1. Connect all 0V to GND pin on Arduino
 * 2. Connect all S1 to pin 11 on Arduino
 * 
 * Created 4 Apr 2020
 * By Alexander Ng
 * 
 * 
 */

#include <SoftwareSerial.h>
#include <Sabertooth.h>

const int X_pin = 0; // analog pin connected to X output
const int Y_pin = 1; // analog pin connected to Y output
const int Z_pin = 2; // analog pin connected to Z output
const int deadzonerange = 30; // deadzone range in center of joystick
// Note: 20 is about the bare minimum deadzone while not touching the joystick
const int center = 512; // analog reads 0-1023, so center is 512

const int timeout = 200;

SoftwareSerial SWSerial(NOT_A_PIN, 11);
Sabertooth LFT(128, SWSerial);
Sabertooth FR1(129, SWSerial);
Sabertooth FR2(130, SWSerial);
Sabertooth RGT(131, SWSerial);

void setup() {
  // put your setup code here, to run once:
  Serial.begin(9600);
  SWSerial.begin(9600);
  LFT.setTimeout(timeout); // Sets timeout (motor stops when no input)
  FR1.setTimeout(timeout);
  FR2.setTimeout(timeout);
  RGT.setTimeout(timeout);
}

void loop() {
  // put your main code here, to run repeatedly:
  int xval = analogRead(X_pin);
  int xstd = xval - center;
  int yval = analogRead(Y_pin);
  int ystd = yval - center;
  int zval = analogRead(Z_pin);
  int zstd = zval - center;
  float xintent = 0;
  float yintent = 0;
  float zintent = 0;

  
  if (abs(xstd) > deadzonerange && abs(zstd) > deadzonerange) {
    // if reading both x and z input, default to z only
    zintent = (float)127 * (float)zstd / (float)512;
    LFT.motor(1, -1 * zintent);
    LFT.motor(2, -1 * zintent);
    RGT.motor(1, -1 * zintent);
    RGT.motor(2, -1 * zintent);
  }
  else if(abs(xstd) > deadzonerange) {
    // L/R translation only
    xintent = (float)127 * (float)xstd / (float)512;
    Serial.println(xintent);
    LFT.motor(1, -1 * xintent);
    LFT.motor(2, xintent);
    RGT.motor(1, -1 * xintent);
    RGT.motor(2, xintent);
  }
  else if(abs(zstd) > deadzonerange) {
    // rotation only
    zintent = (float)127 * (float)zstd / (float)512;
    LFT.motor(1, -1 * zintent);
    LFT.motor(2, -1 * zintent);
    RGT.motor(1, -1 * zintent);
    RGT.motor(2, -1 * zintent);
  }
  

  if(abs(ystd) > deadzonerange) {
    yintent = (float)127 * (float)ystd / (float)512;
    Serial.println(yintent);
    FR1.motor(1, -1 * yintent);
    FR1.motor(2, yintent);
    FR2.motor(1, -1 * yintent);
    FR2.motor(2, yintent);
  }

  
  
  delay(100);
}
