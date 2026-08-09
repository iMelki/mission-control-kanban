const fs = require('node:fs');
const path = require('node:path');

const RECEIPT_SCHEMA_VERSION = 'mck.runtime-smoke-cleanup.v1';

function requestStatus(response) {
  const status = Number(response?.status);
  return Number.isInteger(status) ? status : null;
}

async function callEntityEndpoint(fetchImpl, baseUrl, entityPath, method) {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${entityPath}`, {
      method,
      headers: { Accept: 'application/json' },
    });
    return {
      method,
      status: requestStatus(response),
      ok: Boolean(response?.ok),
      error: null,
    };
  } catch (error) {
    return {
      method,
      status: null,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyRuntimeSmokeCleanup({
  baseUrl,
  entities,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('verifyRuntimeSmokeCleanup requires a fetch implementation');
  }

  const startedAt = now();
  const results = [];

  for (const entity of entities) {
    const deletion = await callEntityEndpoint(fetchImpl, baseUrl, entity.path, 'DELETE');
    const readback = await callEntityEndpoint(fetchImpl, baseUrl, entity.path, 'GET');
    const absent = readback.status === 404;

    results.push({
      kind: entity.kind,
      role: entity.role,
      id: entity.id,
      path: entity.path,
      deletion,
      readback: {
        ...readback,
        expected_status: 404,
        absent,
      },
      ok: deletion.ok && absent,
    });
  }

  return {
    schema_version: RECEIPT_SCHEMA_VERSION,
    ok: results.every((result) => result.ok),
    started_at: startedAt,
    finished_at: now(),
    entity_count: results.length,
    entities: results,
  };
}

function writeRuntimeSmokeCleanupReceipt({ artifactDir, receipt, fsImpl = fs }) {
  fsImpl.mkdirSync(artifactDir, { recursive: true });
  const receiptPath = path.join(artifactDir, 'cleanup-receipt.json');
  fsImpl.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return receiptPath;
}

module.exports = {
  RECEIPT_SCHEMA_VERSION,
  verifyRuntimeSmokeCleanup,
  writeRuntimeSmokeCleanupReceipt,
};
