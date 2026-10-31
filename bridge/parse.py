"""Parses a command's output (stdin) with a TTP template (the file in argv[1]) and prints the result as JSON."""
import json
import sys

from ttp import ttp

parser = ttp(data=sys.stdin.read(), template=open(sys.argv[1]).read())
parser.parse()
result = parser.result()[0]
print(json.dumps(result[0] if result else {}))  # {} when the output is empty
