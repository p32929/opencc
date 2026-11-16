// The pre-commit hook's work: package.json's patch version + 1, in the commit and in the working
// copy, only its "version" line (other changes to package.json, staged or not, are left as they are).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
const versionOf = (text) => JSON.parse(text).version
const root = git('rev-parse', '--show-toplevel').trim()
const file = path.join(root, 'package.json')

const staged = git('show', ':package.json')
let before = null
try {
  before = versionOf(git('show', 'HEAD:package.json'))
} catch {} // the first commit
if (before && versionOf(staged) !== before) process.exit(0) // this commit already sets a version

const [major, minor, patch] = versionOf(staged).split('.').map(Number)
const next = `${major}.${minor}.${patch + 1}`
const bump = (text) => text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${next}$2`)

// the commit's package.json: the staged one with the new version
const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { input: bump(staged), encoding: 'utf8' }).trim()
const mode = git('ls-files', '-s', 'package.json').split(' ')[0]
git('update-index', '--cacheinfo', `${mode},${blob},package.json`)
// the working copy too, keeping any changes not staged
fs.writeFileSync(file, bump(fs.readFileSync(file, 'utf8')))
console.log(`version ${versionOf(staged)} → ${next}`)
