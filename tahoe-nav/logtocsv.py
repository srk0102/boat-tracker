"""
logtocsv.py

Alexander Ng
8/13/2021

logtocsv.py takes in a log file from tahoe-nav and converts it to csv
optional argument to name filename, otherwise will be called output.csv.

Usage:

python logtocsv.py inputfile.log [outputfile.csv]

"""

import csv
import sys

DEFAULT_OUTPUT = "output.csv"

file = open(sys.argv[1])

if len(sys.argv) > 2:
    output_file = sys.argv[2]
else:
    output_file = DEFAULT_OUTPUT

lines = file.read().splitlines()

file.close()
with open(output_file, mode="w", newline="") as output_file:
    output_writer = csv.writer(output_file, delimiter = ',', quotechar = '"', quoting=csv.QUOTE_MINIMAL)
    output_writer.writerow(["type", "time", "latitude", "longitude"])
    for line in lines:
        if not line: 
            continue
        time = line.split(" ")[1][:-1]
        item = line.split("] ")[2]
        if (item and item[1] == "{") :
            item = item.split(": ")
            lat = item[1].split(",")[0]
            lng = item[2].split(" ")[0]
            output_writer.writerow(["T", time, lat,lng])
