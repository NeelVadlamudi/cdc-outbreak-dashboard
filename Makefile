PYTHON ?= python

.PHONY: run test lint check eval

run:
	$(PYTHON) -m uvicorn backend.main:app --reload

# pytest exits with code 5 when no tests are collected; treat that as success.
test:
	$(PYTHON) -m pytest; status=$$?; if [ $$status -eq 5 ]; then exit 0; else exit $$status; fi

lint:
	$(PYTHON) -m ruff check .

# Cheap local gate matching the CI test job lint+pytest steps.
check: lint test

eval:
	python evals/run_evals.py
