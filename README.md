# Tahoe UV-C Vessel Propulsion System

## New to git/Github? (WIP)

Some users may be unfamiliar with git and Github as a method of source control (keeping records of code). A page in the wiki will be opened to elaborate on the purpose of git and basic usage.

## Evaluation
The following video provides a demonstration and overview of the project.

 [Tahoe Project Overview and Demo](https://youtu.be/7mDdOYYlIyk)
 
 Posted April 28, 2020

## Team Members

Alexander Ng

## Introduction

Inventive Resources Inc. (IRI) is performing aquatic invasive plant (AIP) removal in the Lake Tahoe area using UV-C light to kill the plants. The lights are attached to a moveable array which in turn is attached to a floating platform. IRI has asked us to implement controls to move the platform, as well as automate the process with GPS-based pathfinding. In addition, GPS tracking should be implemented to better audit treated areas. 

The project can be broken down into two main parts: manual control and automated control.

### Manual Control

The platform requires manual control - a human driver is needed to maneuver the platform in low-clearance areas (docks, shallow water, high-traffic zones). We will implement a control system to allow for a user to interact with a joystick to control the array of propellers on the platform, allowing for translational and rotational movement.

Manual control can be broken down into two modules: headless and manual-arduino. Headless mode has the joystick directly interface with the motor drivers, and manual-arduino has an Arduino Mega as an intermediary between joystick input and motor driver. The Arduino Mega give some flexibility over headless, namely customization of controls.

### Automated Control

Utilizing GPS, a user will be able to upload a file containing path data, and our program will navigate the platform along the path. Additionally, the program will log the platform's position and orientation, so treatment coverage can be monitored.

### Components
For a list of physical components, see the wiki.
