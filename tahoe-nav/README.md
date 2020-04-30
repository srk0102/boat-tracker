# Tahoe-nav Application

This application will be the GUI for the Arduino implementation of manual 
control as well as the GPS control

## Usage

[Download Node Package Manager (npm)](https://nodejs.org/en/)

`npm install`

`npm run rebuild` 

`npm start`

## Compatible OSes

Application is developed on MacOS and deployed on Windows. Electron is 
platform agnostic and should work on any setup.

## Building on Windows

Not fully tested, but certain conditions need to be met before running 
`npm install` and `npm run rebuild` to successfully build on windows

- Python needs to be installed 

- Windows Build Tools needs to be installed via 
`npm install --global windows-build-tools@4.0.0`

## API Key

In order to access the Google Maps Javascript API, you will need to generate an API key, which should be stored in `tahoe-nav/key.txt` 


