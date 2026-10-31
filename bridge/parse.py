"""Parses a command's output (stdin) with a TTP template (the file in argv[1]) and prints the result as JSON."""
import json
import os
import sys

from ttp import ttp

template = open(sys.argv[1]).read()
os.chdir(os.path.dirname(os.path.abspath(sys.argv[1])))  # TTP finds <extend template="..."/> parts from here
parser = ttp(data=sys.stdin.read(), template=template)
parser.parse()
result = parser.result()[0]
print(json.dumps(result[0] if result else {}))  # {} when the output is empty
