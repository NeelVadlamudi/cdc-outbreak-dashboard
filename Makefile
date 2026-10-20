PYTHON ?= python

.PHONY: run test lint eval

run:
	$(PYTHON) -m uvicorn backend.main:app --reload

# pytest exits with code 5 when no tests are collected; treat that as success.
test:
	$(PYTHON) -m pytest; status=$$?; if [ $$status -eq 5 ]; then exit 0; else exit $$status; fi

lint:
	$(PYTHON) -m ruff check .

eval:
	@echo "No evaluation suite yet."
