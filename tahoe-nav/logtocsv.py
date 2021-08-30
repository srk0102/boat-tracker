"""
logtocsv.py

Alexander Ng
8/28/2021

logtocsv.py
optional argument to input log file from tahoe-nav, will only run on that file
optional argument to name filename, otherwise will be called output.csv.

Usage:

python logtocsv.py

or

python logtocsv.py [inputfile.log] 

or 

python logtocsv.py [inputfile.log] [outputfile.csv]


"""

import csv
import sys
import os

DEFAULT_OUTPUT = "output.csv"

def process_script(input_file, output_file):
    file = open(input_file) # Open file
    lines = file.read().splitlines() # Copy file contents
    file.close()
    with open(output_file, mode="w", newline="") as output_file: # Process lines into output file
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

def main():
    if len(sys.argv) == 3:
        """Input file and Output file arguments given"""
        print(f"Reading in {sys.argv[1]} and outputting to {sys.argv[2]}")
        process_script(sys.argv[1], sys.argv[2])
    elif len(sys.argv) == 2:
        """Input file argument given, output file is default name"""
        print(f"Reading in {sys.argv[1]} and outputting to {DEFAULT_OUTPUT}")
        process_script(sys.argv[1], DEFAULT_OUTPUT)
    else:
        """No arguments are given, script run on all .log files"""
        for file in os.listdir("."):
            if file.endswith(".log") and not file == "app.log":
                output_file = "CSV-" + os.path.splitext(file)[0] + ".csv"
                print(f"Reading in {file} and outputting to {output_file}")
                process_script(file, output_file)


if __name__ == "__main__":
    main()
