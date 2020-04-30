/*
 * joystick_test.ino
 * 
 * This module demonstrates reading joystick input with a deadzone (area around 
 * center of joystick that does not respond to movement)
 * 
 * The production joystick is a three axis joystick (X, Y, and Z)
 * 
 * Potentiometer diagram (X and Y axes):
 *      O
 *     /|\
 *    + S -
 *    
 * Note: for some weird reason, on the production joystick, 
 * the Z pot uses the red and white wires as +/- leads and the black as the sweeper
 *    
 * Setup: Note: a breadboard may be handy to connect multiple leads to single pins.
 * 1. Connect the positive leads on the X and Y potentiometers (leftmost) to 5v pin on Arduino.
 * 2. Connect the negative leads on the X and Y potentiometers (rightmost) to GND pin on Arduino.
 * 3. Connect the X and Y sweepers (middle) to analog pins A0 and A1 respectively.
 * 4. Connect the positive lead on the Z potentiometer (red wire) to the 5v pin on Arduino.
 * 5. Connect the negative lead on the Z potentiometer (white wire) to the GND pin on Arduino.
 * 6. Connect the Z sweeper (black wire) to the analog pin A2
 * 7. Connect Arduino to computer and upload this program to the board (see Arduino documentation).
 * 8. Open serial monitor in Arduino IDE to view output.
 * 
 * Created 21 Mar 2020
 * By Alexander Ng
 * 
 * 
 */

const int X_pin = 0; // analog pin connected to X output
const int Y_pin = 1; // analog pin connected to Y output
const int Z_pin = 2; // analog pin connected to Z output
const int deadzonerange = 25; // deadzone range in center of joystick
// Note: 20 is about the bare minimum deadzone while not touching the joystick
const int center = 512; // analog reads 0-1023, so center is 512

void setup() {
  // put your setup code here, to run once:
  Serial.begin(9600);
}

void loop() {
  // put your main code here, to run repeatedly:
  Serial.print("X-axis: ");
  int xval = analogRead(X_pin);
  if(abs(xval - center) > deadzonerange) {
    Serial.print(xval);
  }
  else {
    Serial.print("Deadzone");
  }
  Serial.print(" | ");
  Serial.print("Y-axis: ");
  int yval = analogRead(Y_pin);
  if(abs(yval - center) > deadzonerange) {
    Serial.print(yval);
  }
  else {
    Serial.print("Deadzone");
  }
  Serial.println(" | ");

  Serial.print("Z-axis: ");
  int zval = analogRead(Z_pin);
  if(abs(zval - center) > deadzonerange) {
    Serial.print(zval);
  }
  else {
    Serial.print("Deadzone");
  }
  Serial.print(" | ");
  
  delay(500);
}
