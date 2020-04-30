# arduino-manual

This implementation allows for control of all motors drivers using only joystick
and Arduino. This method is intended for use in the case of laptop failure and
the Arduino-GPS/Manual mode cannot be used.

Setup involves loading the control program directly to the Arduino - no laptop is 
needed after the program is uploaded.

To upload arduino-manual.ino to the Arduino board, first download and install
the Arduino IDE
https://www.arduino.cc/en/Main/Software

Next, download the Sabertooth Arduino library, and place it in the libraries
folder in your install of the Arduino IDE.
https://www.dimensionengineering.com/info/arduino
https://www.dimensionengineering.com/software/SabertoothArduinoLibraries.zip

A copy of the Sabertooth library can also be found on this repo in the libraries
folder.

Finally, open the arduino-manual.ino file in the Arduino IDE, connect the board 
via USB, and click upload to save the program to the board. The board has now
been prepped for use. 
