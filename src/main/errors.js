// Every error that crosses IPC becomes { code, message, hint, details }. AWS SDK errors
// are mapped by name; our own failures are AppError instances and pass through as-is.

export class AppError extends Error {
  constructor(code, message, { hint = null, details = null } = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.hint = hint
    this.details = details
  }
}

export const CREDENTIAL_ERROR_CODES = new Set(['ExpiredCredentials', 'CredentialsError', 'InvalidCredentials'])

const EXPIRED = new Set(['ExpiredTokenException', 'ExpiredToken', 'RequestExpired'])
const INVALID_CREDENTIALS = new Set(['UnrecognizedClientException', 'InvalidSignatureException', 'InvalidClientTokenId', 'SignatureDoesNotMatch'])
const VALIDATION = new Set([
  'ValidationException',
  'ParameterPatternMismatchException',
  'HierarchyLevelLimitExceededException',
  'HierarchyTypeMismatchException',
  'UnsupportedParameterType',
  'InvalidAllowedPatternException',
  'IncompatiblePolicyException'
])
const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'])

export function versionConflictError(name, currentVersion, expectedVersion) {
  return new AppError(
    'VersionConflict',
    `${name} changed since you opened it: it is now at version ${currentVersion}, and you loaded version ${expectedVersion}.`,
    { hint: 'Reload to get the latest value, or overwrite anyway.', details: { currentVersion } }
  )
}

export function toIpcError(err, context = {}) {
  if (err instanceof AppError) return { code: err.code, message: err.message, hint: err.hint, details: err.details }

  const name = err?.name ?? 'Error'
  const awsMessage = err?.message ?? String(err)
  const profile = context.profile ? `profile "${context.profile}"` : 'this profile'
  const ssoCommand = `aws sso login --profile ${context.profile ?? '<profile>'}`
  const out = (code, message, hint = null) => ({ code, message, hint, details: null })

  if (name === 'AccessDeniedException') {
    const target = context.name ? ` on ${context.name}` : ''
    return out('AccessDenied', `Not allowed to ${context.action ?? 'do that'}${target}.`, `Check the IAM permissions of ${profile}. AWS said: ${awsMessage}`)
  }
  if (EXPIRED.has(name)) {
    return out('ExpiredCredentials', 'Your AWS credentials have expired.', `Refresh the credentials for ${profile}. For SSO profiles run: ${ssoCommand}`)
  }
  if (name === 'CredentialsProviderError' || name === 'TokenProviderError') {
    if (/expired|refresh/i.test(awsMessage)) return out('ExpiredCredentials', 'Your AWS session has expired.', `Run: ${ssoCommand}`)
    return out('CredentialsError', `Could not load credentials for ${profile}.`, `Check the profile in your AWS config and credentials files (Settings → AWS files). ${awsMessage}`)
  }
  if (INVALID_CREDENTIALS.has(name)) {
    return out('InvalidCredentials', 'AWS rejected the credentials.', `The access keys for ${profile} are wrong or have been revoked.`)
  }
  if (name === 'ParameterNotFound') {
    return out('ParameterNotFound', context.name ? `${context.name} no longer exists.` : 'Parameter not found.', 'Someone may have deleted it. The list will refresh.')
  }
  if (name === 'ParameterAlreadyExists') {
    return out('ParameterAlreadyExists', context.name ? `A parameter named ${context.name} already exists.` : 'That parameter already exists.')
  }
  if (name === 'ParameterMaxVersionLimitExceeded') {
    return out('MaxVersionLimit', 'This parameter has reached the 100-version limit.', 'The oldest version has a label, so AWS cannot drop it. Move or remove that label in the AWS console.')
  }
  if (name === 'InvalidKeyId') return out('ValidationError', awsMessage, 'Check the KMS key ID or alias.')
  if (VALIDATION.has(name)) return out('ValidationError', awsMessage)
  if (name === 'ThrottlingException' || name === 'TooManyUpdates') {
    return out('Throttled', 'AWS is throttling requests right now.', 'Wait a few seconds and try again.')
  }
  if (NETWORK_CODES.has(err?.code) || name === 'TimeoutError') {
    return out('NetworkError', 'Could not reach AWS.', "Check your network connection and the connection's region.")
  }
  return out('Unknown', `${name}: ${awsMessage}`)
}
