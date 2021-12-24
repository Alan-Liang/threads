import fs from 'fs'
import Nedb from 'nedb-promise'

const lines = fs.readFileSync('original').toString().split(/\n(?=re:|\d+\.)/s).map(x => x.trim()).filter(Boolean)

const db = new Nedb({
  filename: 'imported',
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
