import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { guard } from './respond.js'
import { MAX_PAGE_SIZE, MAX_ROWS, pageNum, pageSize, rowOffset } from './paging.js'

const quietly = async (fn) => {
  const original = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = original
  }
}

const dbError = (code, message) => Object.assign(new Error(message), { name: 'NeonDbError', code })

const assertGeneric = (res, status, error) => {
  assert.equal(res.statusCode, status)
  assert.deepEqual(JSON.parse(res.body), { error })
  assert.equal(res.headers['Cache-Control'], 'no-store')
  assert.equal(res.headers['Netlify-CDN-Cache-Control'], undefined)
  assert.doesNotMatch(res.body, /NeonDbError|\bat |\/var\/task|node_modules/)
}

test('paging clamps size, floors page and offset, caps depth', () => {
  assert.equal(pageSize('25'), 25)
  assert.equal(pageSize('0'), 50)
  assert.equal(pageSize('99999999999'), MAX_PAGE_SIZE)
  assert.equal(pageNum('-3'), 1)
  assert.equal(pageNum('x'), 1)
  assert.equal(pageNum('99999999999'), MAX_ROWS / 50 + 1)
  assert.equal(rowOffset('-1'), 0)
  assert.equal(rowOffset('99999999999'), MAX_ROWS)
  // Every result stays inside a Postgres integer, whatever comes in.
  assert.ok((pageNum('99999999999') - 1) * pageSize('99999999999') < 2 ** 31)
})

test('guard passes a response through untouched', async () => {
  const res = { statusCode: 200, headers: {}, body: '{}' }
  assert.equal(await guard('x', async () => res)({}), res)
})

test('guard answers a data exception as a generic 400', async () => {
  const handler = guard('x', async () => {
    throw dbError('22P02', 'invalid input syntax for type integer: "x"')
  })
  assertGeneric(await quietly(() => handler({ rawQuery: 'recid=x' })), 400, 'bad request')
})

test('guard answers anything else as a generic 500', async () => {
  const handler = guard('x', async () => {
    throw dbError('57014', 'canceling statement due to statement timeout')
  })
  assertGeneric(await quietly(() => handler({})), 500, 'server error')
  const plain = guard('x', async () => {
    throw new TypeError("Cannot read properties of undefined (reading 'data')")
  })
  assertGeneric(await quietly(() => plain({})), 500, 'server error')
})

// Every function, given a connection string the driver rejects before any
// network call, must answer through guard(). One exported without it throws.
const functionsDir = fileURLToPath(new URL('..', import.meta.url))
const functions = readdirSync(functionsDir).filter((f) => f.endsWith('.js'))

for (const file of functions) {
  test(`${file} exports its handler through guard()`, async () => {
    process.env.DATABASE_URL = 'not-a-connection-string'
    const { handler } = await import(new URL(`../${file}`, import.meta.url))
    let res
    try {
      res = await quietly(() => handler({ queryStringParameters: { action: 'stats' } }))
    } catch (err) {
      assert.fail(`${file} let an error escape: ${err.message}`)
    }
    assertGeneric(res, 500, 'server error')
  })
}
