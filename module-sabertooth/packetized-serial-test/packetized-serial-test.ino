/*
 * packetized-serial-test.ino
 * 
 * This module demonstrates sending packetized serial to the motor driver to control motor behavior.
 * 
 * Each motor driver needs to be switched to packetized serial mode (consult sabertooth datasheet for more info)
 * 
 * Multiple motor drivers can be connected to a single serial pin, but they will require different DIP addresses to receive different info
 * 
 * Created 1 Apr 2020
 * By Alexander Ng
 * 
 */
#include <SoftwareSerial.h>
#include <Sabertooth.h>

SoftwareSerial SWSerial(NOT_A_PIN, 11); // RX on no pin (unused), TX on pin 11 (can be set to any pin)
//SoftwareSerial SWSerial1(NOT_A_PIN, 11);
Sabertooth ST1(128, SWSerial); // The Sabertooth is on address 128 using the DIP switches
Sabertooth ST2(129, SWSerial);

void setup()
{
  SWSerial.begin(9600); // 9600 is the default baud rate for Sabertooth packet serial.
  //SWSerial1.begin(9600);
  //ST.autobaud(); // Technically not needed for this model
}

void loop()
{
  int power;

  // Test direction of motor - power value of |10| is about where direction is clearly visible on test motors
  ST1.motor(1, 10);
  ST1.motor(2, -10); // Note that due to wiring being tied to headless implementation, will need to implement some form of inverting command to reversed motors
  ST2.motor(1, 20);
  ST2.motor(2, -20);
  /*
  // Ramp motor 1 from -127 to 127 (full reverse to full forward),
  for (power = -127; power <= 127; power ++)
  {
    ST.motor(1, power);
    ST.motor(2, power);
    delay(20);
  }
  // And back
  for (power = 127; power >= -127; power --)
  {
    ST.motor(1, power);
    ST.motor(2, power);
    delay(20);          
  }
  */
}
