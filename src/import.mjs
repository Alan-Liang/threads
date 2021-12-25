import fs from 'fs'
import Nedb from 'nedb-promise'

const lines = fs.readFileSync('original').toString().split(/\n(?=re:|\d+\.)/s).map(x => x.trim()).filter(Boolean)

const db = new Nedb({
  filename: 'imported',
  autoload: true,
})

const db2 = new Nedb({
  filename: process.env.DATABASE || 'data.main',
  autoload: true,
})

const metadata = () => ({
  time: Date.now(),
  ip: '127.0.0.1',
  imported: true,
})

const state = []

let nextPostId = 0
let nextThreadId = 1
let currentThread = null
let postStack = null
for (const line of lines) {
  if (line.includes('------------------------------------------------------------------')) break
  if (/^[0-9]+\./.test(line)) {
    const id = nextThreadId++
    if (currentThread >= id) throw new Error(line)
    currentThread = id
    const thread = { id, content: line.match(/^[0-9]+\.(.*)$/s)[1].trim() }
    state[id] = thread
    postStack = [ -1 ]
    await db.insert({ is: 'thread', ...thread, ...metadata() })
    continue
  }
  if (line.startsWith('re:')) {
    const reLevel = line.match(/^(?:re:)+/)[0].length / 3
    const inReplyTo = postStack[reLevel - 1]
    const post = { id: nextPostId++, content: line.replace(/^(?:re:)+/, ''), threadId: currentThread, inReplyTo }
    postStack[reLevel] = post.id
    await db.insert({ is: 'post', ...post, ...metadata() })
    continue
  }
  console.log(line)
  throw 1
}

const threadmap = {}
const patch = (await db2.find({})).filter(x => x.ip !== '127.0.0.1')
for (const thread of patch.filter(x => x.is === 'thread')) {
  const id = nextThreadId++
  threadmap[thread.id] = id
  thread.id = id
  await db.insert(thread)
}

for (const post of patch.filter(x => x.is === 'post').sort((a, b) => a.id - b.id)) {
  const id = nextPostId++
  post.id = id
  if (threadmap[post.threadId]) post.threadId = threadmap[post.threadId]
  if (post.inReplyTo > -1) {
    const orig = await db2.findOne({ is: 'post', id: post.inReplyTo })
    if (!orig) console.log(post)
    const curr = await db.findOne({ is: 'post', content: orig.content })
    if (!curr) console.log(post, orig.content)
    post.inReplyTo = curr.id
  }
  await db.insert(post)
}
