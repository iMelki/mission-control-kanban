# Public schema distributions

`doctor-genome.v1.json` is the public distribution mirror of the canonical
Doctor contract in the private `iMelki/projects-ops` repository. The local
genome uses this public URL so editors and other unauthenticated JSON tooling
can load the schema instead of receiving GitHub's private-repository `404`.

The mirror records the canonical source SHA-256 in
`x-canonical-source-sha256`. Compatible v1 changes must update the private
canonical schema first, refresh this mirror and digest, and pass both the local
schema validation and Doctor coverage tests. Breaking changes require a new
versioned filename instead of silently changing the v1 contract.

Validation:

```powershell
npm run test:doctor-genome
Test-Json -Path .\doctor.genome.json `
  -SchemaFile .\docs\schemas\doctor-genome.v1.json `
  -ErrorAction Stop
```

After pushing the active branch, also verify that the exact `$schema` URI
returns HTTP `200` and that the downloaded body matches the committed mirror.
VS Code documents `$schema` as a supported JSON-file association and warns
when remote schema downloads fail. JSON Schema itself distinguishes a schema
identifier from guaranteed network retrieval, so this public mirror is a
tooling distribution surface rather than a replacement authority.

References:

- [VS Code JSON schema associations](https://code.visualstudio.com/docs/languages/json#_json-schemas-and-settings)
- [JSON Schema identifiers and retrieval](https://json-schema.org/understanding-json-schema/structuring)
