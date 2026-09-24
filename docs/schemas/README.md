# Local schema copies

`doctor-genome.v1.json` is a **byte-faithful mirror** of the canonical Doctor
contract in the private `iMelki/projects-ops` repository. Its SHA-256 is
`afe8676e1c3c78c8d3c2a52915bea4246a09da2f82770fbe115ee2722323d272`, and
`tests/doctor-genome.test.mjs` hashes the file on every run, so the mirror
cannot silently diverge from the document it claims to mirror.

## The mirror is not a `$schema` target

`doctor.genome.json` must declare

```
https://raw.githubusercontent.com/iMelki/projects-ops/main/docs/schemas/doctor-genome.v1.json
```

That is not a preference. The authority is git-toolkit's own vendored copy at
`doctor/schemas/doctor-genome.v1.json`, which
`hooks/Compare-RepoDoctorPolicy.ps1` validates every genome against at
pre-commit, and whose `$schema` pattern accepts only the `projects-ops`
`main` or `dev` URI.

An earlier revision pointed the genome at this repository's own copy of the
schema and rewrote that copy's pattern to allow it. No consumer reads the local
copy, so the relaxation was inert while the genome it was written to authorise
was rejected. Because the classifier validates the **baseline** — the genome at
`HEAD`, not the staged one — the one-line repair could not pass the gate that
demanded it. Classification `invalid`, exit 2, and `invalid` has no approval
path: the repository accepted no commit at all for three scoring rounds. See
issue #149.

## Editors and offline tooling

The canonical URI returns HTTP `404` to unauthenticated clients because
`iMelki/projects-ops` is private. This is expected and must not be "fixed" by
changing `$schema`. Validate locally against the mirror instead:

```powershell
npm run test:doctor-genome
Test-Json -Path .\doctor.genome.json `
  -SchemaFile .\docs\schemas\doctor-genome.v1.json `
  -ErrorAction Stop
```

Editors that want inline validation should associate the file by path rather
than by `$schema` — VS Code's `json.schemas` setting accepts a workspace-relative
`url` such as `./docs/schemas/doctor-genome.v1.json`. That association is not
configured in this repository today, and VS Code does not document how it ranks
against an in-document `$schema`, so it is offered as a local preference, not as
a supported guarantee.

## Changing the contract

Compatible v1 changes must land in the private canonical schema first, then
refresh this mirror and the digest recorded in the test in the same commit.
Breaking changes require a new versioned filename; the v1 contract is never
silently changed.

References:

- [VS Code JSON schema associations](https://code.visualstudio.com/docs/languages/json#_json-schemas-and-settings)
- [JSON Schema identifiers and retrieval](https://json-schema.org/understanding-json-schema/structuring)
