#!/bin/bash

set -ex

export LOG_LEVEL=debug

cd e2e_tests/python

# Run the Python integ test
uv pip install -r requirements.txt
python main.py
