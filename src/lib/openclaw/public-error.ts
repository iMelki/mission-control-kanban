// Redact secrets from OpenClaw gateway errors before they are returned to clients.

const REDACTED = '[redacted]';

const SENSITIVE_QUERY = /([?&](?:token|access_token|refresh_token|secret|api[_-]?key|password|authorization)=)[^&\s#]+/gi;
const BEARER = /(bearer\s+)\S+/gi;
const HEADER_PAIR = /((?:authorization|x-[\w-]*?(?:token|secret|key|authorization))\s*[:=]\s*)(?:bearer\s+)?\S+/gi;
const JSON_SECRET_FIELDS = /("(?:token|access_token|refresh_token|secret|authorization|api[_-]?key|password|x-[\w-]*token)"\s*:\s*")[^"]*(")/gi;
const ENV_ASSIGN = /((?:OPENCLAW_GATEWAY_TOKEN|MCK_WEBHOOK_CALLBACK_SIGNATURE_SECRET|MCK_WEBHOOK_SIGNATURE_SECRET)\s*[=:]\s*)\S+/g;

export function redactGatewayErrorText(text: string): string {
  return text
    .replace(SENSITIVE_QUERY, `$1${REDACTED}`)
    .replace(HEADER_PAIR, `$1${REDACTED}`)
    .replace(BEARER, `$1${REDACTED}`)
    .replace(JSON_SECRET_FIELDS, `$1${REDACTED}$2`)
    .replace(ENV_ASSIGN, `$1${REDACTED}`);
}

export type PublicGatewayError = {
  message: string;
  code?: string | number;
};

function isPublicCode(value: unknown): value is string | number {
  return (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.trim().length > 0);
}

/** Extract a client-safe gateway error message and optional code. */
export function toPublicGatewayError(err: unknown, fallback = 'Unknown error'): PublicGatewayError {
  let message = fallback;
  let code: string | number | undefined;

  if (err instanceof Error) {
    if (err.message.trim()) {
      message = err.message;
    }
    const maybeCode = (err as Error & { code?: unknown }).code;
    if (isPublicCode(maybeCode)) {
      code = maybeCode;
    }
  } else if (typeof err === 'object' && err !== null) {
    const obj = err as { message?: unknown; code?: unknown };
    if (typeof obj.message === 'string' && obj.message.trim()) {
      message = obj.message;
    }
    if (isPublicCode(obj.code)) {
      code = obj.code;
    }
  } else if (typeof err === 'string' && err.trim()) {
    message = err;
  }

  const publicError: PublicGatewayError = { message: redactGatewayErrorText(message) };
  if (code !== undefined) {
    publicError.code = typeof code === 'string' ? redactGatewayErrorText(code) : code;
  }
  return publicError;
}
