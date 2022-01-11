import Koa from 'koa'
import Router from '@koa/router'
import body from 'koa-body'
import serve from 'koa-static'
import { Server as IoServer } from 'socket.io'
import http from 'http'
import { readFileSync } from 'fs'
import Nedb from 'nedb-promise'
import fetch from 'node-fetch'

const token = (process.env.TOKEN || 'test').split(',')
const deleteToken = process.env.DELETE_TOKEN || 'delete'
const approveToken = process.env.APPROVE_TOKEN || 'approve'

const db = new Nedb({
  filename: process.env.DATABASE || 'data',
  autoload: true,
})

const stopwords = readFileSync(process.env.STOPWORDS || 'data.stop').toString().split('\n').map(x => x.trim()).filter(Boolean)

const app = new Koa()
const router = new Router()
app.use(body()).use((ctx, next) => {
  if (ctx.path.startsWith('/memories')) ctx.path = ctx.path.replace('/memories', '')
  return next()
}).use(serve('static'))
app.use(router.routes()).use(router.allowedMethods())

const server = http.createServer(app.callback())
const io = new IoServer(server)
server.listen(parseInt(process.env.PORT || 8080))

const state = []

let nextThreadId = 1
let nextPostId = 0

; {
  const threads = await db.find({ is: 'thread' })
  threads.sort((a, b) => a.id - b.id)
  if (threads.length > 0) nextThreadId = threads[threads.length - 1].id + 1
  for (const { id, content, deleted } of threads) if (!deleted) state[id] = { id, content, posts: [] }
  const posts = await db.find({ is: 'post' })
  posts.sort((a, b) => a.id - b.id)
  if (posts.length > 0) nextPostId = posts[posts.length - 1].id + 1
  for (const post of posts) {
    const { id, threadId, content, inReplyTo, deleted } = post
    if (!deleted) state[threadId]?.posts.push({ id, content, inReplyTo })
  }
}

const metadata = socket => ({
  time: Date.now(),
  ip: socket.handshake.headers['x-forwarded-for'] || socket.handshake.address,
  user: socket.handshake.headers['discourse-user-name'],
})

const tgUrl = process.env.TG_URL, tgId = process.env.TG_ID
const sendTg = msg => tgUrl && fetch(tgUrl, { method: 'post', body: new URLSearchParams({ chat_id: tgId, text: msg }) }).then(x => x.json()).catch(e => console.log(e))

io.use((socket, next) => {
  const tok = socket.handshake.auth?.token
  if (!token.includes(tok)) {
    if (tok) console.log(`${Date.now()} ${socket.handshake.headers['x-forwarded-for'] || socket.handshake.address} ${tok}`)
    return next(new Error('Not authorized'))
  }
  return next()
}).on('connection', socket => {
  socket.emit('init', state, nextThreadId)
  socket.on('thread', async content => {
    if (typeof content !== 'string') return
    if (content.length === 0 || content.length > 65) return
    const id = nextThreadId++
    if (stopwords.some(word => content.includes(word))) {
      await db.insert({ id, content, posts: [], is: 'badthread', ...metadata(socket) })
      sendTg(`bad thread ${id}: ${content}`)
      content = '帖子内容正在等待管理员审核中'
    }
    state[id] = { id, content, posts: [] }
    io.emit('thread', state[id], nextThreadId)
    sendTg(`thread ${id}: ${content}`)
    await db.insert({ is: 'thread', ...state[id], ...metadata(socket) })
  })
  socket.on('post', async (content, threadId, inReplyTo) => {
    if (typeof content !== 'string') return
    if (content.length === 0 || content.length > 4096) return
    if (typeof threadId !== 'number' || typeof inReplyTo !== 'number') return
    if (!state[threadId]) return
    if (inReplyTo !== -1 && state[threadId].posts.every(post => post.id !== inReplyTo)) return
    if (content === deleteToken) {
      if (inReplyTo < 0) {
        delete state[threadId]
        await db.update({ is: 'thread', id: threadId }, { $set: { deleted: true } })
        sendTg(`deleted thread ${threadId}`)
      } else {
        const { posts } = state[threadId]
        posts.splice(posts.findIndex(p => p.id === inReplyTo), 1)
        await db.update({ is: 'post', id: inReplyTo }, { $set: { deleted: true } })
        sendTg(`deleted post ${inReplyTo}`)
      }
      return
    }
    if (content === approveToken) {
      if (inReplyTo < 0) {
        const thread = await db.findOne({ is: 'badthread', id: threadId })
        if (!thread || thread.approved) {
          sendTg(`attempted to approve thread ${threadId} which does not need to be approved`)
          return
        }
        state[threadId].content = thread.content
        await db.update({ is: 'thread', id: threadId }, { $set: { content: thread.content } })
        await db.update({ is: 'badthread', id: threadId }, { $set: { approved: true } })
        sendTg(`approved thread ${threadId}`)
      } else {
        const post = await db.findOne({ is: 'badpost', id: inReplyTo })
        if (!post || post.approved) {
          sendTg(`attempted to approve post ${inReplyTo} (of thread ${post?.threadId}) which does not need to be approved`)
          return
        }
        const local = state[post.threadId]?.posts.find(post => post.id === inReplyTo)
        if (local) local.content = post.content
        else sendTg(`error approving post ${inReplyTo}: cannot find post in local db`)
        await db.update({ is: 'post', id: inReplyTo }, { $set: { content: post.content } })
        await db.update({ is: 'badpost', id: inReplyTo }, { $set: { approved: true } })
        sendTg(`approved post ${inReplyTo} (of thread ${post.threadId})`)
      }
      return
    }
    const id = nextPostId++
    if (stopwords.some(word => content.includes(word))) {
      await db.insert({ id, content, threadId, inReplyTo, is: 'badpost', ...metadata(socket) })
      sendTg(`bad post ${id} (of thread ${threadId}): ${content.slice(0, 64)}`)
      content = '回复内容正在等待管理员审核中'
    }
    const post = { id, content, threadId, inReplyTo }
    state[threadId].posts.push(post)
    io.emit('post', post)
    sendTg(`post ${id} (of thread ${threadId}): ${content.slice(0, 64)}`)
    await db.insert({ is: 'post', ...post, ...metadata(socket) })
  })
})
