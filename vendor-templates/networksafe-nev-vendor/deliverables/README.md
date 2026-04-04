# Vendor Deliverables

External vendors should submit final artifacts here before internal review.

Use the templates in this directory and keep the filenames stable so internal review can diff revisions.

Required contents:

- Hardware schematics and PCB package
- Firmware binaries and flashing instructions
- Companion binaries or source package
- Acceptance logs and screenshots
- Change request documents for any contract drift

## Required files

- `01-firmware-release.md`
- `02-companion-package.md`
- `03-acceptance-evidence.md`
- `04-visual-evidence.md`
- `05-change-request.md`

## Review rules

- Do not attach production keys, customer data, or internal control-plane code.
- If a contract change is needed, submit it in `05-change-request.md` before changing any stable interface.
- If no change request is needed, keep `05-change-request.md` and mark it as `No requested changes`.
