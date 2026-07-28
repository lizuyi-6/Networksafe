# generate-unknown v0.2

Generate an information-insufficient candidate: redacted content, missing headers,
truncated logs, conflicting weak signals, unknown endpoint semantics, missing
identity, partial encoding, body-versus-argument ambiguity, missing behavior context,
or several weak families.

The output must use `verdict=unknown`, confidence at most `0.60`, family `other`, and
must not claim the request is safe. Do not invent missing context. Never use sealed
test samples. Include complete pending provenance.
