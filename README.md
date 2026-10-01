# Vault Manager

A desktop client for **AWS Systems Manager Parameter Store** that looks like MongoDB Compass.
It lists every parameter with the same columns as the AWS console and edits values as `.env` text.
It also shows a diff before every save, browses version history, and compares two parameters,
even across AWS accounts.

Plain JavaScript on Electron, electron-vite, CodeMirror 6, and the AWS SDK v3.

## Requirements

- Node.js 20.19 or newer
- AWS profiles in `~/.aws/config` and/or `~/.aws/credentials` (static keys and SSO both work)

## Getting started

```bash
npm install
npm run demo   # fake in-memory data, never touches AWS
npm run dev    # real AWS, using your local profiles
```

1. Create a **connection**: a name, an AWS profile, a region, an optional path prefix, a color,
   and optionally **Read-only**. Read-only is recommended for production.
2. **Connect** to browse parameters. Click a row or a tree leaf to open it in a tab.
3. Edit the value and press **Ctrl+S**. Review the diff and save a new version.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run against real AWS with hot reload |
| `npm run demo` | Run with the fake backend (`VAULT_FAKE_SSM=1`) |
| `npm run build` | Build main, preload, and renderer into `out/` |
| `npm start` | Run the built app (real AWS) |
| `npm test` | Unit and renderer tests (Vitest) |
| `npm run test:e2e` | Build, then the Playwright Electron tests (fake backend) |
| `npm run dist` | Build a Linux AppImage and `.deb` into `dist/` |

## IAM permissions

Reading needs `ssm:DescribeParameters`, `ssm:GetParameter`, `ssm:GetParameterHistory`,
`ssm:ListTagsForResource`, and `kms:Decrypt` for SecureStrings that use a customer-managed key.

Writing also needs `ssm:PutParameter`, `ssm:DeleteParameter`, and `kms:Encrypt`
(again, only for customer-managed keys).

## Security

- Credentials stay in your AWS files. The app stores only connection names, profile names,
  regions, and display settings, in Electron's `userData` folder.
- Only the main process talks to AWS. The UI runs sandboxed, with context isolation and a
  strict Content Security Policy.
- Values are never logged. Diffs and comparisons mask values until you reveal them, and you can
  turn this off in Settings.

## Manual checklist against real AWS

Automated tests never call AWS. Before trusting a build, go through this list with a
non-production profile:

- [ ] Connections: profiles from both `config` and `credentials` appear; **Test connection** succeeds; a wrong region shows a clear error.
- [ ] The list matches the AWS console: count, Name, Tier, Type, Data type, Version, Last modified, Last modified user, and Description.
- [ ] Pagination: an account with more than 50 parameters lists all of them.
- [ ] A path prefix on the connection limits the list.
- [ ] Opening a SecureString shows the decrypted value. With **auto-decrypt** off it shows "Decrypt & show".
- [ ] Editing and saving creates a new version in the console, with the same KMS key, description, and tier.
- [ ] Editing the same parameter in the console while the tab is open, then saving, shows the conflict dialog.
- [ ] A value over 4 KB on a Standard parameter asks to upgrade to Advanced, and the console shows Advanced afterwards.
- [ ] History lists every version. **Restore** puts an old value in the editor, and saving creates a new version.
- [ ] Create and delete work, and deleting requires typing the full name.
- [ ] Compare works across two connections that use different AWS accounts.
- [ ] A read-only connection shows no Save, Create, or Delete actions.
- [ ] An expired SSO session shows the `aws sso login --profile …` hint.
- [ ] A profile without `ssm:PutParameter` shows "Not allowed to write on …".
