import { describe, expect, it } from 'vitest'
import { AppError, CREDENTIAL_ERROR_CODES, toIpcError, versionConflictError } from '../../src/main/errors.js'

const awsError = (name, message = 'AWS says no', extra = {}) => Object.assign(new Error(message), { name, ...extra })
const ctx = { action: 'write', name: '/myapp/prod/env', profile: 'prod' }

describe('toIpcError', () => {
  it('passes AppError through unchanged', () => {
    const err = new AppError('ReadOnlyConnection', 'Read only.', { hint: 'Edit it.', details: { x: 1 } })
    expect(toIpcError(err)).toEqual({ code: 'ReadOnlyConnection', message: 'Read only.', hint: 'Edit it.', details: { x: 1 } })
  })

  it('maps AccessDeniedException with the action, target, and profile', () => {
    const out = toIpcError(awsError('AccessDeniedException', 'User is not authorized to perform ssm:PutParameter'), ctx)
    expect(out.code).toBe('AccessDenied')
    expect(out.message).toBe('Not allowed to write on /myapp/prod/env.')
    expect(out.hint).toContain('profile "prod"')
    expect(out.hint).toContain('ssm:PutParameter')
  })

  it.each(['ExpiredTokenException', 'ExpiredToken', 'RequestExpired'])('maps %s to ExpiredCredentials', (name) => {
    const out = toIpcError(awsError(name), ctx)
    expect(out.code).toBe('ExpiredCredentials')
    expect(out.hint).toContain('aws sso login --profile prod')
  })

  it('maps credential provider errors, separating expired SSO sessions', () => {
    expect(toIpcError(awsError('CredentialsProviderError', 'The SSO session has expired'), ctx).code).toBe('ExpiredCredentials')
    expect(toIpcError(awsError('TokenProviderError', 'SSO Token refresh failed'), ctx).code).toBe('ExpiredCredentials')
    const missing = toIpcError(awsError('CredentialsProviderError', 'Could not resolve credentials using profile: [prod]'), ctx)
    expect(missing.code).toBe('CredentialsError')
    expect(missing.message).toBe('Could not load credentials for profile "prod".')
  })

  it.each(['UnrecognizedClientException', 'InvalidSignatureException', 'InvalidClientTokenId', 'SignatureDoesNotMatch'])(
    'maps %s to InvalidCredentials',
    (name) => expect(toIpcError(awsError(name), ctx).code).toBe('InvalidCredentials')
  )

  it('maps parameter-level errors', () => {
    expect(toIpcError(awsError('ParameterNotFound'), ctx)).toMatchObject({ code: 'ParameterNotFound', message: '/myapp/prod/env no longer exists.' })
    expect(toIpcError(awsError('ParameterNotFound'))).toMatchObject({ message: 'Parameter not found.' })
    expect(toIpcError(awsError('ParameterAlreadyExists'), ctx)).toMatchObject({ code: 'ParameterAlreadyExists', message: 'A parameter named /myapp/prod/env already exists.' })
    expect(toIpcError(awsError('ParameterMaxVersionLimitExceeded'), ctx)).toMatchObject({ code: 'MaxVersionLimit' })
    expect(toIpcError(awsError('ParameterMaxVersionLimitExceeded'), ctx).hint).toContain('label')
  })

  it('passes validation messages through', () => {
    expect(toIpcError(awsError('ValidationException', 'Value too long'), ctx)).toMatchObject({ code: 'ValidationError', message: 'Value too long' })
    expect(toIpcError(awsError('ParameterPatternMismatchException', 'Bad pattern'), ctx)).toMatchObject({ code: 'ValidationError', message: 'Bad pattern' })
    expect(toIpcError(awsError('InvalidKeyId', 'Key not found'), ctx)).toMatchObject({ code: 'ValidationError', hint: 'Check the KMS key ID or alias.' })
  })

  it('maps throttling and network failures', () => {
    expect(toIpcError(awsError('ThrottlingException'), ctx).code).toBe('Throttled')
    expect(toIpcError(awsError('Error', 'getaddrinfo ENOTFOUND ssm.sa-east-1.amazonaws.com', { code: 'ENOTFOUND' }), ctx).code).toBe('NetworkError')
    expect(toIpcError(awsError('TimeoutError', 'socket timeout'), ctx).code).toBe('NetworkError')
  })

  it('falls back to Unknown with the original name and message', () => {
    expect(toIpcError(awsError('WeirdError', 'something odd'))).toEqual({ code: 'Unknown', message: 'WeirdError: something odd', hint: null, details: null })
    expect(toIpcError('plain string').code).toBe('Unknown')
  })
})

describe('helpers', () => {
  it('builds version conflict errors', () => {
    const err = versionConflictError('/a', 5, 4)
    expect(err).toBeInstanceOf(AppError)
    expect(err.code).toBe('VersionConflict')
    expect(err.message).toBe('/a changed since you opened it: it is now at version 5, and you loaded version 4.')
    expect(err.details).toEqual({ currentVersion: 5 })
  })

  it('lists the credential error codes', () => {
    expect([...CREDENTIAL_ERROR_CODES].sort()).toEqual(['CredentialsError', 'ExpiredCredentials', 'InvalidCredentials'])
  })
})
