import Nedb from 'nedb-promise'

const db = new Nedb({
  filename: process.env.DATABASE || 'data',
  autoload: true,
})

const metadata = () => ({
  time: Date.now(),
  ip: '127.0.0.1',
  imported: true,
})

const threads = (await db.find({ is: 'thread' })).sort((a, b) => a.id - b.id)
const posts = (await db.find({ is: 'post' })).sort((a, b) => a.id - b.id)

const moveThread = (oldId, newId) => {
  if (threads.some(x => x.id === newId)) throw new Error()
  threads.find(x => x.id === oldId).id = newId
  posts.filter(x => x.threadId === oldId).forEach(post => post.threadId = newId)
}

const cmd = {
  ins (id, content) {
    id = Number(id)
    console.log(`ins ${id} ${content}`)
    threads.filter(x => x.id >= id).reverse().forEach(thread => moveThread(thread.id, thread.id + 1))
    threads.push({ id, content, is: 'thread', ...metadata() })
    threads.sort((a, b) => a.id - b.id)
  },
  modt (id, content) {
    id = Number(id)
    console.log(`modt ${id} ${content}`)
    threads.find(x => x.id === id).content = content
  },
  modp (id, content) {
    id = Number(id)
    console.log(`modp ${id} ${content}`)
    posts.find(x => x.id === id).content = content
  },
  movep (start, end, to) {
    start = Number(start)
    end = Number(end)
    to = Number(to)
    console.log(`movep ${start} ${end}`)
    posts.filter(x => x.id >= start && x.id < end).forEach(post => post.threadId = to)
  },
}

if (process.argv[2] === 'main') {

const badids = [ 92, 110 ]
const badthreads = threads.filter(x => badids.includes(x.id))

const fix = badid => {
  const postsbad = posts.filter(post => post.threadId === badid)
  let shouldBe = badid
  for (const post of postsbad) {
    post.threadId = shouldBe
    if (/\n\s*\d+[:：]/.test(post.content)) {
      const { goodcontent, nextcontent } = post.content.match(/^(?<goodcontent>.+)\n\d+[:：]\s*(?<nextcontent>.+)$/s).groups
      post.content = goodcontent.trim()
      cmd.ins(++shouldBe, nextcontent.trim())
    }
  }
}

for (const thread of badthreads) fix(thread.id)
for (const x of [ 92, 98 ]) fix(x)

cmd.modt(93, '或许这里可以有一些图集')
posts.push({ is: 'post', id: posts[posts.length - 1].id + 1, content: '来张麦克斯韦方程组\n(注:麦克斯韦方程组的图完成于某年寒假的电磁学课午休时间。当时的讲课老师为北大王奶奶)', threadId: 93, inReplyTo: -1, ...metadata() })

} else {

const inss = `
ins|58|如何评价高校长
movep|988|992|58
modp|987|啊？无法想象帅气的他变秃……恐怖qwq
`

for (const [ ins, ...argv ] of inss.split('\n').filter(Boolean).map(x => x.split('|'))) cmd[ins](...argv)

}

const dbw = new Nedb({
  filename: process.env.DBW || 'data.w',
  autoload: true,
})
for (const rec of [ ...threads, ...posts ]) await dbw.insert(rec)
