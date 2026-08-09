# Builds church-scan against the Futronic vendor library.
# Run ./setup.sh first — it populates vendor/ (libScanAPI.so) and nbis/ (mindtct etc).
CC      ?= gcc
CFLAGS  ?= -O2 -Wall
VENDOR  := vendor

church-scan: church-scan.c ftrScanAPI.h $(VENDOR)/libScanAPI.so
	$(CC) $(CFLAGS) -o $@ church-scan.c -L$(VENDOR) -l:libScanAPI.so -Wl,-rpath,'$$ORIGIN/$(VENDOR)' -lm

$(VENDOR)/libScanAPI.so:
	@echo "vendor/libScanAPI.so missing — run ./setup.sh first" && exit 1

clean:
	rm -f church-scan

.PHONY: clean
