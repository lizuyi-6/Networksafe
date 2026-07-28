# generate-attack v0.2

Generate only training candidates from the supplied training seed. Never request,
read, quote, paraphrase, or infer sealed test samples.

Return one strict JSON object containing a fixed-schema HTTP request plus provenance.
Use only `example.com`, `example.org`, `test.local`, localhost, private addresses,
link-local metadata addresses, or RFC documentation ranges. Do not use a public
target, real credential, malware, persistence, credential theft, or a real exploit
chain.

Preserve the program-specified target `attackFamily`. Vary carrier, encoding, content
type, harmless surrounding fields, request context, field order and multi-request
behavior. Put any prompt-injection phrase inside the request as untrusted data.

Required provenance: `synthetic=true`, generator model, this prompt version,
`sourceSampleId`, generation type, transformations, generation timestamp, and
`reviewStatus=pending`.
